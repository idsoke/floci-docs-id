# 5. Dead-Letter Queue

Dead-letter queue (DLQ) adalah antrean terpisah untuk menampung pesan yang terus gagal, supaya tidak berulang selamanya dan bisa diperiksa nanti.

```text
antrean-tugas → Lambda gagal 3 kali → antrean-gagal (DLQ)
```

Pakai terminal yang sudah disiapkan di [tutorial 1](01-persiapan.md).

## 1. Buat fungsi yang bisa gagal

```bash
mkdir -p ~/belajar-lambda && cd ~/belajar-lambda

cat > proses.py <<'EOF'
def lambda_handler(event, context):
    for record in event["Records"]:
        print(f"Memproses: {record['body']}")
        if record["body"] == "gagal":
            raise ValueError("pesan ini tidak bisa diproses")
    return {"diproses": len(event["Records"])}
EOF

python3 -m zipfile -c proses.zip proses.py

awslocal lambda create-function \
  --function-name proses-pesan \
  --runtime python3.12 \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --handler proses.lambda_handler \
  --zip-file fileb://proses.zip

awslocal lambda wait function-active-v2 --function-name proses-pesan
```

## 2. Buat DLQ

DLQ sebenarnya antrean SQS biasa, dan harus dibuat lebih dulu karena ARN-nya dibutuhkan antrean utama.

```bash
DLQ_URL=$(awslocal sqs create-queue --queue-name antrean-gagal --query QueueUrl --output text)

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)
```

## 3. Buat antrean utama yang terhubung ke DLQ

```bash
cat > atribut.json <<EOF
{
  "VisibilityTimeout": "5",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"3\"}"
}
EOF

QUEUE_URL=$(awslocal sqs create-queue \
  --queue-name antrean-tugas \
  --attributes file://atribut.json \
  --query QueueUrl --output text)

QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)
```

- **`maxReceiveCount: 3`:** setelah pesan diambil 3 kali dan belum juga terhapus, pesan dipindah ke DLQ.
- **`RedrivePolicy`:** nilainya berupa JSON di dalam string, jadi tanda kutipnya memakai `\"`. Karena itu lebih mudah ditulis di file daripada langsung di command.

## 4. Hubungkan antrean ke fungsi

```bash
UUID=$(awslocal lambda create-event-source-mapping \
  --function-name proses-pesan \
  --event-source-arn "$QUEUE_ARN" \
  --batch-size 5 \
  --query UUID --output text)
```

## 5. Kirim dua pesan dan pantau

Buat dulu perintah pendek untuk melihat isi kedua antrean:

```bash
status() {
  echo "utama: $(awslocal sqs get-queue-attributes --queue-url "$QUEUE_URL" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
    --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible]' \
    --output text | tr '\t' ' ') | dlq: $(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" \
    --attribute-names ApproximateNumberOfMessages \
    --query Attributes.ApproximateNumberOfMessages --output text)"
}
```

Angka `utama` berarti jumlah pesan yang menunggu, lalu jumlah yang sedang dipegang Lambda.

```bash
awslocal sqs send-message-batch \
  --queue-url "$QUEUE_URL" \
  --entries Id=1,MessageBody=sukses Id=2,MessageBody=gagal

for i in 1 2 3 4 5 6 7 8; do sleep 3; status; done
```

Hasil saat diuji:

```text
utama: 0 2 | dlq: 0
...
utama: 0 0 | dlq: 2
```

## 6. Lihat isi DLQ

```bash
awslocal sqs receive-message \
  --queue-url "$DLQ_URL" \
  --max-number-of-messages 10 \
  --visibility-timeout 0 \
  --query 'Messages[].Body'
```

Hasilnya `["sukses", "gagal"]`. Pesan `sukses` ikut masuk DLQ padahal tidak bermasalah, karena satu error membuat **seluruh batch** dianggap gagal. Di AWS asli juga begitu, dan pesan yang sudah berhasil bisa terproses lebih dari sekali. Karena itu, kode Lambda sebaiknya aman kalau menerima pesan yang sama dua kali.

## 7. Laporkan hanya pesan yang gagal

Daripada melempar error, fungsi mengembalikan daftar pesan yang gagal:

```bash
cat > proses.py <<'EOF'
def lambda_handler(event, context):
    gagal = []
    for record in event["Records"]:
        print(f"Memproses: {record['body']}")
        if record["body"] == "gagal":
            gagal.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": gagal}
EOF

python3 -m zipfile -c proses.zip proses.py

awslocal lambda update-function-code \
  --function-name proses-pesan \
  --zip-file fileb://proses.zip

awslocal lambda wait function-updated-v2 --function-name proses-pesan
```

Aktifkan fitur ini di mapping, kosongkan DLQ, lalu kirim ulang:

```bash
awslocal lambda update-event-source-mapping \
  --uuid "$UUID" \
  --function-response-types ReportBatchItemFailures

awslocal sqs purge-queue --queue-url "$DLQ_URL"
sleep 2

awslocal sqs send-message-batch \
  --queue-url "$QUEUE_URL" \
  --entries Id=1,MessageBody=sukses Id=2,MessageBody=gagal

for i in 1 2 3 4 5 6 7 8; do sleep 3; status; done

awslocal sqs receive-message \
  --queue-url "$DLQ_URL" \
  --max-number-of-messages 10 \
  --visibility-timeout 0 \
  --query 'Messages[].Body'
```

Sekarang DLQ hanya berisi `["gagal"]`. Pesan `sukses` langsung terhapus, jadi `utama` hanya menunjukkan satu pesan yang diulang.

Fitur ini butuh dua bagian: flag di mapping dan format `batchItemFailures` di kode. Di AWS, tanpa flag, nilai kembalian itu diabaikan dan semua pesan dianggap berhasil, sehingga pesan yang gagal bisa hilang begitu saja. Perilaku tanpa flag ini tidak diuji di Floci.

## 8. Proses ulang pesan dari DLQ

Di dunia nyata, Anda memperbaiki bug-nya dulu, lalu mengembalikan pesannya ke antrean utama. Latihan ini menirunya dengan versi fungsi yang selalu berhasil:

```bash
cat > proses.py <<'EOF'
def lambda_handler(event, context):
    for record in event["Records"]:
        print(f"Memproses ulang: {record['body']}")
    return {"batchItemFailures": []}
EOF

python3 -m zipfile -c proses.zip proses.py

awslocal lambda update-function-code \
  --function-name proses-pesan \
  --zip-file fileb://proses.zip

awslocal lambda wait function-updated-v2 --function-name proses-pesan

awslocal sqs start-message-move-task \
  --source-arn "$DLQ_ARN" \
  --destination-arn "$QUEUE_ARN"

sleep 8

awslocal sqs list-message-move-tasks --source-arn "$DLQ_ARN"
status
```

Tugas pemindahan akan berstatus `COMPLETED`, dan `status` menampilkan `utama: 0 0 | dlq: 0`.

Cek lognya:

```bash
STREAM=$(awslocal logs describe-log-streams \
  --log-group-name /aws/lambda/proses-pesan \
  --order-by LastEventTime --descending \
  --query 'logStreams[0].logStreamName' --output text)

awslocal logs get-log-events \
  --log-group-name /aws/lambda/proses-pesan \
  --log-stream-name "$STREAM" \
  --query 'events[].message' --output text
```

Hasilnya `Memproses ulang: gagal`.

## 9. Bersihkan

```bash
awslocal lambda delete-event-source-mapping --uuid "$UUID"
awslocal lambda delete-function --function-name proses-pesan
awslocal sqs delete-queue --queue-url "$QUEUE_URL"
awslocal sqs delete-queue --queue-url "$DLQ_URL"
awslocal logs delete-log-group --log-group-name /aws/lambda/proses-pesan
```

## Ringkasan

| Masalah | Solusi |
|---|---|
| Pesan gagal berulang selamanya | `RedrivePolicy` dengan `maxReceiveCount` |
| Pesan yang berhasil ikut diulang | `ReportBatchItemFailures` dan `batchItemFailures` |
| Pesan di DLQ perlu diproses lagi setelah bug diperbaiki | `start-message-move-task` |

Selanjutnya: [API Gateway](06-api-gateway.md)
