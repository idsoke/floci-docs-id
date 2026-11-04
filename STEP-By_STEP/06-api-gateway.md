# 6. API Gateway

Dengan API Gateway, fungsi Lambda bisa dipanggil lewat URL biasa, misalnya dengan `curl` atau dari browser. Tutorial ini memakai **HTTP API** (`apigatewayv2`), jenis API Gateway yang lebih sederhana.

```text
curl → route → integration → Lambda
              (dalam stage dev)
```

- **Route:** aturan metode dan path, misalnya `GET /halo`.
- **Integration:** tujuan request, di sini fungsi Lambda.
- **Stage:** versi API yang bisa diakses, misalnya `dev` atau `prod`, dan menjadi bagian dari URL.

Pakai terminal yang sudah disiapkan di [tutorial 1](01-persiapan.md).

## 1. Buat fungsinya

```bash
mkdir -p ~/belajar-lambda && cd ~/belajar-lambda

cat > api.py <<'EOF'
import json

def lambda_handler(event, context):
    metode = event["requestContext"]["http"]["method"]
    path = event["rawPath"]
    print(f"{metode} {path}")

    if metode == "GET":
        nama = (event.get("queryStringParameters") or {}).get("nama", "dunia")
        hasil = {"pesan": f"Halo, {nama}!"}
        status = 200
    else:
        data = json.loads(event.get("body") or "{}")
        hasil = {"diterima": data}
        status = 201

    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(hasil),
    }
EOF

python3 -m zipfile -c api.zip api.py

FUNCTION_ARN=$(awslocal lambda create-function \
  --function-name api-fungsi \
  --runtime python3.12 \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --handler api.lambda_handler \
  --zip-file fileb://api.zip \
  --query FunctionArn --output text)

awslocal lambda wait function-active-v2 --function-name api-fungsi
```

Fungsi untuk API punya aturan sendiri:

- **Yang dikembalikan:** `statusCode`, `headers`, dan `body`, yang menjadi respons HTTP.
- **`body`:** harus berupa string, sehingga perlu `json.dumps`. Body request yang masuk juga berupa string, sehingga perlu `json.loads`.
- **`queryStringParameters`:** tidak ada kalau URL tidak punya `?...`, sehingga kodenya memakai `or {}`.

## 2. Buat API

```bash
API_ID=$(awslocal apigatewayv2 create-api \
  --name belajar-api \
  --protocol-type HTTP \
  --query ApiId --output text)

echo $API_ID
```

## 3. Hubungkan API ke Lambda

```bash
INTEGRATION_ID=$(awslocal apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type AWS_PROXY \
  --integration-uri "$FUNCTION_ARN" \
  --payload-format-version 2.0 \
  --query IntegrationId --output text)
```

`AWS_PROXY` berarti seluruh request diteruskan apa adanya ke fungsi. `2.0` menentukan bentuk `event`, seperti `requestContext.http.method` yang dipakai kode tadi.

## 4. Buat route

```bash
awslocal apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key "GET /halo" \
  --target "integrations/$INTEGRATION_ID"

awslocal apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key "POST /siswa" \
  --target "integrations/$INTEGRATION_ID"
```

## 5. Buat stage

```bash
awslocal apigatewayv2 create-stage \
  --api-id "$API_ID" \
  --stage-name dev \
  --auto-deploy
```

`--auto-deploy` membuat perubahan route langsung berlaku di stage ini.

## 6. Beri izin API untuk memanggil Lambda

```bash
awslocal lambda add-permission \
  --function-name api-fungsi \
  --statement-id izin-api \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com
```

Saat diuji, Floci tetap menjalankan fungsi walaupun izin ini belum ada. Di AWS asli, tanpa izin ini API akan gagal, jadi biasakan selalu menambahkannya.

## 7. Panggil lewat HTTP

```bash
BASE_URL=http://$API_ID.execute-api.localhost.floci.io:4566/dev

curl "$BASE_URL/halo?nama=Budi"
curl "$BASE_URL/halo"

curl -X POST "$BASE_URL/siswa" \
  -H 'Content-Type: application/json' \
  -d '{"nama":"Sari","kelas":"10A"}'
```

| Request | Status | Hasil |
|---|---|---|
| `GET /halo?nama=Budi` | 200 | `{"pesan": "Halo, Budi!"}` |
| `GET /halo` | 200 | `{"pesan": "Halo, dunia!"}` |
| `POST /siswa` | 201 | `{"diterima": {"nama": "Sari", "kelas": "10A"}}` |

Tambahkan `-i` pada `curl` untuk melihat status HTTP-nya.

Kalau nama host itu gagal di jaringan Anda, pakai bentuk ini:

```bash
curl "http://localhost:4566/execute-api/$API_ID/dev/halo?nama=Budi"
```

## 8. Coba route yang tidak ada

```bash
curl "$BASE_URL/tidak-ada"
curl -X DELETE "$BASE_URL/halo"
```

Keduanya menghasilkan `{"message":"Not Found"}` dengan status 404. Route dicocokkan dari metode **dan** path, jadi `DELETE /halo` berbeda dari `GET /halo`, dan fungsi Lambda tidak dipanggil sama sekali.

## 9. Lihat log

```bash
STREAM=$(awslocal logs describe-log-streams \
  --log-group-name /aws/lambda/api-fungsi \
  --order-by LastEventTime --descending \
  --query 'logStreams[0].logStreamName' --output text)

awslocal logs get-log-events \
  --log-group-name /aws/lambda/api-fungsi \
  --log-stream-name "$STREAM" \
  --query 'events[].message' --output text
```

Hasilnya berisi baris seperti `GET /halo` dan `POST /siswa` dari `print`.

## 10. Kenali error di sisi fungsi

```bash
cat > api.py <<'EOF'
def lambda_handler(event, context):
    return 1 / 0
EOF

python3 -m zipfile -c api.zip api.py

awslocal lambda update-function-code \
  --function-name api-fungsi \
  --zip-file fileb://api.zip

awslocal lambda wait function-updated-v2 --function-name api-fungsi

curl -i "$BASE_URL/halo"
```

Pemanggil hanya melihat status 500 dengan `{"message":"Internal Server Error"}`, tanpa detail error. Detailnya ada di log, jadi ulangi langkah 9 untuk melihatnya.

## 11. Bersihkan

```bash
awslocal apigatewayv2 delete-api --api-id "$API_ID"
awslocal lambda delete-function --function-name api-fungsi
awslocal logs delete-log-group --log-group-name /aws/lambda/api-fungsi
```

## Cara membaca status error

| Status | Artinya | Yang dicek |
|---|---|---|
| 404 `Not Found` | Tidak ada route yang cocok, fungsi tidak dipanggil | Metode, path, dan nama stage di URL |
| 500 `Internal Server Error` | Fungsi error | Log fungsi |

Selanjutnya: [IAM](07-iam.md)
