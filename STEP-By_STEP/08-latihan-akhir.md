# 8. Latihan Akhir: Aplikasi Pendaftaran Siswa

Latihan ini menggabungkan semua layanan menjadi satu aplikasi, di port 4567 dengan pemeriksaan izin aktif. Cara menjalankan server-nya ada di [tutorial 1](01-persiapan.md).

```text
curl → API Gateway → siswa-api → DynamoDB (data siswa)
                         ↓
                    SQS kartu-tugas → siswa-worker → S3 (kartu siswa)
                         ↓ gagal 2 kali
                    SQS kartu-gagal (DLQ)
```

Saat mendaftar, siswa langsung mendapat jawaban. Pembuatan kartunya berjalan terpisah lewat antrean, jadi kalau pembuatan kartu gagal, pendaftaran tetap aman.

## 1. Siapkan terminal

```bash
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=""
alias iamlocal='aws --endpoint-url=http://localhost:4567'

mkdir -p ~/belajar-final && cd ~/belajar-final
```

## 2. Buat tempat penyimpanan

```bash
TABLE_ARN=$(iamlocal dynamodb create-table \
  --table-name Siswa \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --query TableDescription.TableArn --output text)

iamlocal s3 mb s3://kartu-siswa
```

## 3. Buat antrean dan DLQ

```bash
DLQ_URL=$(iamlocal sqs create-queue --queue-name kartu-gagal --query QueueUrl --output text)
DLQ_ARN=$(iamlocal sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

cat > atribut.json <<EOF
{
  "VisibilityTimeout": "60",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"2\"}"
}
EOF

QUEUE_URL=$(iamlocal sqs create-queue --queue-name kartu-tugas \
  --attributes file://atribut.json --query QueueUrl --output text)
QUEUE_ARN=$(iamlocal sqs get-queue-attributes --queue-url "$QUEUE_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)
```

## 4. Buat role dengan izin seperlunya

Tiap fungsi punya role sendiri, berisi hanya izin yang dipakainya:

```bash
cat > kepercayaan-lambda.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}
  ]
}
EOF

cat > izin-api.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": ["dynamodb:PutItem", "dynamodb:GetItem"], "Resource": "$TABLE_ARN"},
    {"Effect": "Allow", "Action": "sqs:SendMessage", "Resource": "$QUEUE_ARN"}
  ]
}
EOF

cat > izin-worker.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], "Resource": "$QUEUE_ARN"},
    {"Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::kartu-siswa/*"}
  ]
}
EOF

API_ROLE_ARN=$(iamlocal iam create-role --role-name peran-api \
  --assume-role-policy-document file://kepercayaan-lambda.json --query Role.Arn --output text)
iamlocal iam put-role-policy --role-name peran-api --policy-name izin-api --policy-document file://izin-api.json

WORKER_ROLE_ARN=$(iamlocal iam create-role --role-name peran-worker \
  --assume-role-policy-document file://kepercayaan-lambda.json --query Role.Arn --output text)
iamlocal iam put-role-policy --role-name peran-worker --policy-name izin-worker --policy-document file://izin-worker.json

iamlocal iam attach-role-policy --role-name peran-api \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
iamlocal iam attach-role-policy --role-name peran-worker \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

`AWSLambdaBasicExecutionRole` adalah policy bawaan AWS yang mengizinkan fungsi menulis log.

## 5. Tulis fungsi API

```bash
cat > api.py <<'EOF'
import json
import os

import boto3
from botocore.exceptions import ClientError

tabel = boto3.resource("dynamodb").Table(os.environ["NAMA_TABEL"])
sqs = boto3.client("sqs")


def jawab(status, isi):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(isi),
    }


def daftar(event):
    try:
        data = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return jawab(400, {"error": "body harus JSON"})

    if not data.get("id") or not data.get("nama"):
        return jawab(400, {"error": "id dan nama wajib diisi"})

    siswa = {"id": str(data["id"]), "nama": str(data["nama"])}
    try:
        tabel.put_item(Item=siswa, ConditionExpression="attribute_not_exists(id)")
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return jawab(409, {"error": "id sudah terdaftar"})
        raise

    sqs.send_message(QueueUrl=os.environ["URL_ANTREAN"], MessageBody=json.dumps(siswa))
    return jawab(201, siswa)


def lihat(event):
    hasil = tabel.get_item(Key={"id": event["pathParameters"]["id"]})
    if "Item" not in hasil:
        return jawab(404, {"error": "siswa tidak ditemukan"})
    return jawab(200, hasil["Item"])


def lambda_handler(event, context):
    print(event["routeKey"])
    if event["routeKey"] == "POST /siswa":
        return daftar(event)
    return lihat(event)
EOF
```

- **`ConditionExpression`:** membuat DynamoDB menolak `id` yang sudah ada, supaya data lama tidak tertimpa.
- **`os.environ`:** nama tabel dan URL antrean dibaca dari environment variable, bukan ditulis langsung di kode.
- **Client di luar handler:** dibuat sekali, lalu dipakai ulang selama container masih hidup.

## 6. Tulis fungsi worker

```bash
cat > worker.py <<'EOF'
import json
import os

import boto3

s3 = boto3.client("s3")


def buat_kartu(siswa):
    if siswa["nama"] == "ERROR":
        raise ValueError("nama tidak valid untuk kartu")
    s3.put_object(
        Bucket=os.environ["NAMA_BUCKET"],
        Key=f"kartu/{siswa['id']}.txt",
        Body=f"KARTU SISWA\nID: {siswa['id']}\nNama: {siswa['nama']}\n".encode(),
    )


def lambda_handler(event, context):
    gagal = []
    for record in event["Records"]:
        try:
            buat_kartu(json.loads(record["body"]))
        except Exception as error:
            print(f"Gagal memproses {record['messageId']}: {error}")
            gagal.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": gagal}
EOF
```

Pengecekan nama `ERROR` adalah bug buatan untuk latihan langkah 11.

## 7. Deploy kedua fungsi

```bash
python3 -m zipfile -c api.zip api.py
python3 -m zipfile -c worker.zip worker.py

API_FN_ARN=$(iamlocal lambda create-function \
  --function-name siswa-api \
  --runtime python3.12 \
  --role "$API_ROLE_ARN" \
  --handler api.lambda_handler \
  --zip-file fileb://api.zip \
  --timeout 15 \
  --environment "Variables={NAMA_TABEL=Siswa,URL_ANTREAN=$QUEUE_URL}" \
  --query FunctionArn --output text)
iamlocal lambda wait function-active-v2 --function-name siswa-api

iamlocal lambda create-function \
  --function-name siswa-worker \
  --runtime python3.12 \
  --role "$WORKER_ROLE_ARN" \
  --handler worker.lambda_handler \
  --zip-file fileb://worker.zip \
  --timeout 10 \
  --environment "Variables={NAMA_BUCKET=kartu-siswa}"
iamlocal lambda wait function-active-v2 --function-name siswa-worker

UUID=$(iamlocal lambda create-event-source-mapping \
  --function-name siswa-worker \
  --event-source-arn "$QUEUE_ARN" \
  --batch-size 5 \
  --function-response-types ReportBatchItemFailures \
  --query UUID --output text)
```

## 8. Buat API

```bash
API_ID=$(iamlocal apigatewayv2 create-api --name siswa-api --protocol-type HTTP --query ApiId --output text)

INTEGRATION_ID=$(iamlocal apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type AWS_PROXY \
  --integration-uri "$API_FN_ARN" \
  --payload-format-version 2.0 \
  --query IntegrationId --output text)

iamlocal apigatewayv2 create-route --api-id "$API_ID" --route-key "POST /siswa" --target "integrations/$INTEGRATION_ID"
iamlocal apigatewayv2 create-route --api-id "$API_ID" --route-key "GET /siswa/{id}" --target "integrations/$INTEGRATION_ID"
iamlocal apigatewayv2 create-stage --api-id "$API_ID" --stage-name dev --auto-deploy

iamlocal lambda add-permission \
  --function-name siswa-api \
  --statement-id izin-api-gateway \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com

BASE_URL=http://localhost:4567/execute-api/$API_ID/dev
```

`{id}` di route adalah bagian URL yang bisa berubah, dan nilainya dibaca kode lewat `event["pathParameters"]["id"]`.

## 9. Coba aplikasinya

```bash
curl -i -X POST "$BASE_URL/siswa" -H 'Content-Type: application/json' -d '{"id":"1","nama":"Budi"}'
curl -i -X POST "$BASE_URL/siswa" -H 'Content-Type: application/json' -d '{"id":"2","nama":"Sari"}'
curl -i "$BASE_URL/siswa/1"
curl -i "$BASE_URL/siswa/99"
curl -i -X POST "$BASE_URL/siswa" -H 'Content-Type: application/json' -d '{"id":"1","nama":"Budi lagi"}'
curl -i -X POST "$BASE_URL/siswa" -H 'Content-Type: application/json' -d '{"nama":"tanpa id"}'
curl -i -X POST "$BASE_URL/siswa" -H 'Content-Type: application/json' -d 'bukan json'
```

| Request | Status | Hasil |
|---|---|---|
| Daftar Budi | 201 | `{"id": "1", "nama": "Budi"}` |
| Daftar Sari | 201 | `{"id": "2", "nama": "Sari"}` |
| Lihat siswa 1 | 200 | `{"id": "1", "nama": "Budi"}` |
| Lihat siswa 99 | 404 | `siswa tidak ditemukan` |
| Daftar id 1 lagi | 409 | `id sudah terdaftar` |
| Tanpa id | 400 | `id dan nama wajib diisi` |
| Bukan JSON | 400 | `body harus JSON` |

Cek hasil di tiap layanan:

```bash
iamlocal dynamodb scan --table-name Siswa --query 'Items[].[id.S,nama.S]' --output text
iamlocal s3 ls s3://kartu-siswa/kartu/
iamlocal s3 cp s3://kartu-siswa/kartu/1.txt -
```

Isi kartunya:

```text
KARTU SISWA
ID: 1
Nama: Budi
```

## 10. Buktikan least privilege

Periksa dulu lewat simulasi:

```bash
iamlocal iam simulate-principal-policy \
  --policy-source-arn "$API_ROLE_ARN" \
  --action-names dynamodb:GetItem dynamodb:DeleteItem s3:PutObject \
  --resource-arns "$TABLE_ARN" \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text
```

Hanya `dynamodb:GetItem` yang `allowed`, sedangkan dua lainnya `implicitDeny`.

Lalu coba sungguhan, dengan fungsi sementara yang memakai role API untuk menghapus data:

```bash
cat > uji.py <<'EOF'
import boto3

def lambda_handler(event, context):
    boto3.resource("dynamodb").Table("Siswa").delete_item(Key={"id": "1"})
    return {"terhapus": True}
EOF
python3 -m zipfile -c uji.zip uji.py

iamlocal lambda create-function --function-name uji-izin --runtime python3.12 \
  --role "$API_ROLE_ARN" --handler uji.lambda_handler --zip-file fileb://uji.zip --timeout 15
iamlocal lambda wait function-active-v2 --function-name uji-izin

iamlocal lambda invoke --function-name uji-izin hasil.json
cat hasil.json

curl "$BASE_URL/siswa/1"

iamlocal lambda delete-function --function-name uji-izin
iamlocal logs delete-log-group --log-group-name /aws/lambda/uji-izin
```

Fungsinya gagal dengan `AccessDeniedException`, dan data Budi tetap ada. Kalaupun kode fungsi API punya celah, dampaknya tetap terbatas pada izin role tersebut.

## 11. Tangani kegagalan sampai pulih

Perpendek waktu tunggu supaya percobaan ulang cepat terlihat, lalu daftarkan siswa yang memicu bug:

```bash
iamlocal sqs set-queue-attributes --queue-url "$QUEUE_URL" --attributes VisibilityTimeout=5

curl -i -X POST "$BASE_URL/siswa" -H 'Content-Type: application/json' -d '{"id":"3","nama":"ERROR"}'

sleep 20
iamlocal sqs receive-message --queue-url "$DLQ_URL" --visibility-timeout 0 --query 'Messages[0].Body' --output text
iamlocal s3 ls s3://kartu-siswa/kartu/
```

Pendaftaran tetap sukses (201). Setelah dua kali gagal, pesannya pindah ke DLQ, sehingga kartu nomor 3 belum ada. Saat diuji, pesan masuk DLQ dalam sekitar 15 detik.

Perbaiki bug-nya, lalu kembalikan pesan ke antrean utama:

```bash
sed -i '/if siswa\["nama"\] == "ERROR":/,+1d' worker.py
python3 -m zipfile -c worker.zip worker.py

iamlocal lambda update-function-code --function-name siswa-worker --zip-file fileb://worker.zip
iamlocal lambda wait function-updated-v2 --function-name siswa-worker

iamlocal sqs start-message-move-task --source-arn "$DLQ_ARN" --destination-arn "$QUEUE_ARN"

sleep 5
iamlocal s3 ls s3://kartu-siswa/kartu/
```

Sekarang `3.txt` muncul, jadi tidak ada data yang hilang walaupun worker sempat rusak.

Angka 5 detik di sini hanya untuk latihan. Timeout worker 10 detik, jadi nilai `60` di langkah 3 adalah yang sesuai saran AWS (6 kali timeout).

## 12. Bersihkan

```bash
iamlocal apigatewayv2 delete-api --api-id "$API_ID"
iamlocal lambda delete-event-source-mapping --uuid "$UUID"
iamlocal lambda delete-function --function-name siswa-api
iamlocal lambda delete-function --function-name siswa-worker
iamlocal logs delete-log-group --log-group-name /aws/lambda/siswa-api
iamlocal logs delete-log-group --log-group-name /aws/lambda/siswa-worker

iamlocal iam detach-role-policy --role-name peran-api \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
iamlocal iam detach-role-policy --role-name peran-worker \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
iamlocal iam delete-role-policy --role-name peran-api --policy-name izin-api
iamlocal iam delete-role --role-name peran-api
iamlocal iam delete-role-policy --role-name peran-worker --policy-name izin-worker
iamlocal iam delete-role --role-name peran-worker

iamlocal sqs delete-queue --queue-url "$QUEUE_URL"
iamlocal sqs delete-queue --queue-url "$DLQ_URL"
iamlocal dynamodb delete-table --table-name Siswa
iamlocal s3 rb s3://kartu-siswa --force
```

`awslambda-us-east-1-tasks` yang masih terlihat di `s3 ls` adalah bucket internal yang dibuat Floci, jadi biarkan saja.

## Yang sudah dikuasai

| Layanan | Yang dipelajari |
|---|---|
| S3 | Menyimpan dan membaca file |
| DynamoDB | Menyimpan data dan mencegah penimpaan dengan kondisi |
| SQS | Memisahkan proses, percobaan ulang, DLQ, dan pemindahan ulang pesan |
| Lambda | Kode, environment variable, log, dan pemicu dari antrean |
| API Gateway | Route, stage, dan respons HTTP |
| IAM | User, role, trust policy, dan least privilege |

## Sebelum dipakai di AWS asli

- **Keamanan API:** route di latihan ini terbuka tanpa login, jadi tambahkan autentikasi, misalnya dengan Cognito.
- **Duplikat pesan:** SQS bisa mengirim pesan yang sama lebih dari sekali. Worker ini aman karena hanya menimpa kartu yang sama, tetapi tidak semua proses seperti itu.
- **Konsistensi data:** kalau `send_message` gagal setelah `put_item` berhasil, siswa tersimpan tanpa kartu. Solusi umumnya adalah DynamoDB Streams.
