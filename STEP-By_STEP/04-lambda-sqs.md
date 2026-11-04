# 4. Lambda Dipicu SQS

Di sini Anda tidak memanggil fungsinya sendiri. Layanan Lambda memantau antrean, mengambil pesan, menjalankan fungsi, lalu menghapus pesan kalau fungsinya berhasil. Hubungan antara antrean dan fungsi ini disebut **event source mapping**.

```text
send-message → SQS → event source mapping → Lambda
```

Pakai terminal yang sudah disiapkan di [tutorial 1](01-persiapan.md).

## 1. Tulis fungsinya

```bash
mkdir -p ~/belajar-lambda && cd ~/belajar-lambda

cat > proses.py <<'EOF'
def lambda_handler(event, context):
    records = event["Records"]
    print(f"Menerima {len(records)} pesan")
    for record in records:
        print(f"Memproses: {record['body']}")
    return {"diproses": len(records)}
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

Satu `event` bisa berisi beberapa pesan di `event["Records"]`, jadi kodenya perlu perulangan. Isi pesannya ada di `record["body"]`.

## 2. Buat antrean dan ambil ARN-nya

```bash
QUEUE_URL=$(awslocal sqs create-queue --queue-name antrean-tugas --query QueueUrl --output text)

QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)

echo $QUEUE_ARN
```

URL dipakai untuk mengirim dan menerima pesan, sedangkan ARN adalah identitas antrean yang dibutuhkan layanan lain.

## 3. Hubungkan antrean ke fungsi

```bash
UUID=$(awslocal lambda create-event-source-mapping \
  --function-name proses-pesan \
  --event-source-arn "$QUEUE_ARN" \
  --batch-size 5 \
  --query UUID --output text)

awslocal lambda get-event-source-mapping --uuid "$UUID"
```

`--batch-size 5` berarti satu pemanggilan menerima paling banyak 5 pesan. Tunggu sampai `State` bernilai `Enabled`.

## 4. Kirim pesan

```bash
awslocal sqs send-message --queue-url "$QUEUE_URL" --message-body "tugas pertama"
awslocal sqs send-message --queue-url "$QUEUE_URL" --message-body "tugas kedua"
```

Tunggu beberapa detik, lalu cek antreannya:

```bash
awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

Kedua angkanya akan `0`, karena pesannya sudah diproses dan dihapus otomatis. Anda tidak perlu memanggil `delete-message` lagi.

## 5. Buktikan lewat log

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

Hasil saat diuji:

```text
Menerima 1 pesan    Memproses: tugas pertama    Menerima 1 pesan    Memproses: tugas kedua
```

Kedua pesan diproses dalam pemanggilan terpisah walaupun `--batch-size` bernilai 5. Angka itu hanya batas atas, bukan jumlah yang ditunggu.

## 6. Lihat apa yang terjadi kalau fungsinya gagal

Ubah fungsinya supaya error saat menerima pesan `gagal`, dan perpendek waktu tunggu antrean:

```bash
cat > proses.py <<'EOF'
def lambda_handler(event, context):
    for record in event["Records"]:
        print(f"Memproses: {record['body']}")
        if record["body"] == "gagal":
            raise ValueError("pesan ini tidak bisa diproses")
    return {"diproses": len(event["Records"])}
EOF

python3 -m zipfile -c proses.zip proses.py

awslocal lambda update-function-code \
  --function-name proses-pesan \
  --zip-file fileb://proses.zip

awslocal lambda wait function-updated-v2 --function-name proses-pesan

awslocal sqs set-queue-attributes --queue-url "$QUEUE_URL" --attributes VisibilityTimeout=5

awslocal sqs send-message --queue-url "$QUEUE_URL" --message-body "gagal"
```

Pantau pesannya selama sekitar 30 detik:

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  awslocal sqs get-queue-attributes \
    --queue-url "$QUEUE_URL" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
    --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible]' \
    --output text
  sleep 3
done
```

- **`0  1`:** pesan sedang dipegang Lambda.
- **`1  0`:** pesan kembali ke antrean, siap dicoba lagi.

Pesan yang gagal tidak hilang, dan fungsi terus mencobanya lagi. Saat diuji, percobaan ulangnya terjadi sekitar setiap 6 detik. Tanpa penanganan khusus, pesan seperti ini bisa terus berulang, sehingga di sistem nyata biasanya dipasang [dead-letter queue](05-dead-letter-queue.md).

## 7. Bersihkan

Hapus mapping lebih dulu supaya percobaan ulangnya berhenti:

```bash
awslocal lambda delete-event-source-mapping --uuid "$UUID"
awslocal lambda delete-function --function-name proses-pesan
awslocal sqs delete-queue --queue-url "$QUEUE_URL"
awslocal logs delete-log-group --log-group-name /aws/lambda/proses-pesan
```

Output penghapusan mapping di Floci masih menampilkan `"State": "Enabled"`, tetapi mapping-nya benar-benar terhapus. Cek dengan `awslocal lambda list-event-source-mappings`, hasilnya harus kosong.

## Yang berbeda di AWS asli

- **Izin:** role fungsi harus punya izin membaca dan menghapus pesan SQS, misalnya lewat policy `AWSLambdaSQSQueueExecutionRole`.
- **Visibility timeout:** nilainya tidak boleh lebih kecil dari timeout fungsi, dan AWS menyarankan minimal 6 kali lipatnya. Angka 5 detik di sini hanya supaya percobaan ulangnya cepat terlihat.

Selanjutnya: [Dead-letter queue](05-dead-letter-queue.md)
