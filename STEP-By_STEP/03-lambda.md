# 3. Lambda

Lambda menjalankan kode Anda hanya saat dipanggil, tanpa perlu mengurus server. Di Floci, kode itu berjalan di dalam container Docker, jadi Docker harus menyala.

Pakai terminal yang sudah disiapkan di [tutorial 1](01-persiapan.md).

## 1. Tulis kode fungsinya

```bash
mkdir -p ~/belajar-lambda && cd ~/belajar-lambda

cat > handler.py <<'EOF'
import json

def lambda_handler(event, context):
    nama = event.get("nama", "dunia")
    print(f"Menerima event: {json.dumps(event)}")
    return {"pesan": f"Halo, {nama}!"}
EOF
```

- **`event`:** data yang dikirim oleh pemanggil.
- **`context`:** informasi tentang eksekusi yang sedang berjalan.
- **`return`:** hasil yang diterima pemanggil.
- **`print`:** masuk ke log, bukan ke hasil.

## 2. Bungkus jadi zip

```bash
python3 -m zipfile -c fungsi.zip handler.py
```

Lambda menerima kode dalam bentuk zip.

## 3. Buat fungsinya

```bash
awslocal lambda create-function \
  --function-name halo-fungsi \
  --runtime python3.12 \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --handler handler.lambda_handler \
  --zip-file fileb://fungsi.zip

awslocal lambda wait function-active-v2 --function-name halo-fungsi
```

- **`--handler`:** formatnya `nama_file.nama_fungsi`, jadi `handler.lambda_handler` menunjuk ke `lambda_handler` di `handler.py`.
- **`--role`:** izin yang dipakai fungsi. Di port 4566 role ini tidak perlu dibuat dulu, tetapi di AWS asli role harus sudah ada. Penjelasannya ada di [tutorial IAM](07-iam.md).
- **`fileb://`:** membaca file sebagai data biner.

## 4. Panggil fungsinya

```bash
awslocal lambda invoke \
  --function-name halo-fungsi \
  --payload '{"nama":"Budi"}' \
  hasil.json

cat hasil.json
```

Hasilnya:

```json
{"pesan": "Halo, Budi!"}
```

`StatusCode: 200` di terminal hanya berarti pemanggilan terkirim, sedangkan hasil fungsinya ada di `hasil.json`.

Pemanggilan pertama bisa lama. Saat diuji butuh sekitar 47 detik, sebagian besar kemungkinan untuk mengunduh image `public.ecr.aws/lambda/python:3.12` (754 MB). Pemanggilan berikutnya sekitar 1 detik karena container-nya masih hidup.

## 5. Perbarui kodenya

```bash
sed -i 's/Halo, /Selamat datang, /' handler.py
python3 -m zipfile -c fungsi.zip handler.py

awslocal lambda update-function-code \
  --function-name halo-fungsi \
  --zip-file fileb://fungsi.zip

awslocal lambda wait function-updated-v2 --function-name halo-fungsi

awslocal lambda invoke --function-name halo-fungsi --payload '{"nama":"Budi"}' hasil.json
cat hasil.json
```

Sekarang hasilnya `{"pesan": "Selamat datang, Budi!"}`.

## 6. Baca log

```bash
STREAM=$(awslocal logs describe-log-streams \
  --log-group-name /aws/lambda/halo-fungsi \
  --order-by LastEventTime --descending \
  --query 'logStreams[0].logStreamName' --output text)

awslocal logs get-log-events \
  --log-group-name /aws/lambda/halo-fungsi \
  --log-stream-name "$STREAM" \
  --query 'events[].message' --output text
```

Hasilnya memuat `Menerima event: {"nama": "Budi"}` dari `print` tadi.

## 7. Kenali fungsi yang error

```bash
cat > rusak.py <<'EOF'
def lambda_handler(event, context):
    return 1 / 0
EOF
python3 -m zipfile -c rusak.zip rusak.py

awslocal lambda create-function \
  --function-name rusak \
  --runtime python3.12 \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --handler rusak.lambda_handler \
  --zip-file fileb://rusak.zip

awslocal lambda wait function-active-v2 --function-name rusak

awslocal lambda invoke --function-name rusak hasil-rusak.json
cat hasil-rusak.json
```

Perhatikan outputnya: `StatusCode` tetap 200 dan exit code CLI tetap 0, walaupun fungsinya gagal. Tanda gagalnya adalah `"FunctionError": "Unhandled"`, dan detailnya (`ZeroDivisionError`) ada di `hasil-rusak.json`. Saat mengotomasi, periksa `FunctionError`, jangan hanya `StatusCode`.

## 8. Bersihkan

```bash
awslocal lambda delete-function --function-name halo-fungsi
awslocal lambda delete-function --function-name rusak
awslocal logs delete-log-group --log-group-name /aws/lambda/halo-fungsi
awslocal logs delete-log-group --log-group-name /aws/lambda/rusak
```

Log group perlu dihapus sendiri, karena tidak ikut terhapus bersama fungsinya.

## Beda dari tutorial di internet

- **`--cli-binary-format raw-in-base64-out`:** banyak tutorial memakainya, tetapi flag ini hanya ada di CLI versi 2. Di CLI versi 1 yang dipakai di sini, command-nya gagal dengan `Unknown options`.
- **`aws logs tail`:** ini juga tidak ada di CLI versi 1, jadi tutorial ini memakai `get-log-events`.
- **`--log-type Tail`:** Floci menerima flag ini tetapi tidak mengembalikan `LogResult`, sedangkan AWS asli mengembalikannya. Ini celah di Floci, jadi baca log lewat langkah 6.

Selanjutnya: [Lambda dipicu SQS](04-lambda-sqs.md)
