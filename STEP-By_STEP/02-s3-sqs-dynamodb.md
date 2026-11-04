# 2. S3, SQS, dan DynamoDB

Pakai terminal yang sudah disiapkan di [tutorial 1](01-persiapan.md).

## Pola command

```text
awslocal <layanan> <operasi> --parameter nilai
```

Coba dengan mengecek identitas Anda:

```bash
awslocal sts get-caller-identity
```

Hasilnya menampilkan akun `000000000000`, yaitu akun bawaan Floci.

## S3: penyimpanan file

```bash
# Buat bucket
awslocal s3 mb s3://belajar-bucket

# Upload file
echo "Halo dari Floci" > halo.txt
awslocal s3 cp halo.txt s3://belajar-bucket/halo.txt

# Lihat isi bucket
awslocal s3 ls s3://belajar-bucket

# Tampilkan isi file di terminal
awslocal s3 cp s3://belajar-bucket/halo.txt -
```

Command terakhir mencetak `Halo dari Floci`.

## SQS: antrean pesan

```bash
# Buat antrean dan simpan URL-nya
QUEUE_URL=$(awslocal sqs create-queue --queue-name belajar-queue --query QueueUrl --output text)
echo $QUEUE_URL

# Kirim pesan
awslocal sqs send-message --queue-url "$QUEUE_URL" --message-body "pesan pertama"

# Ambil pesan dan simpan tanda terimanya
HANDLE=$(awslocal sqs receive-message --queue-url "$QUEUE_URL" --query 'Messages[0].ReceiptHandle' --output text)

# Hapus pesan yang sudah diproses
awslocal sqs delete-message --queue-url "$QUEUE_URL" --receipt-handle "$HANDLE"
```

Pesan yang sudah diambil tidak langsung hilang. Pesan disembunyikan sementara (default AWS 30 detik) dan muncul lagi kalau tidak dihapus. Kalau Anda mengambilnya dua kali berturut-turut, yang kedua kosong dan `HANDLE` berisi `None`, lalu `delete-message` gagal dengan `ReceiptHandleIsInvalid`.

`--query` mengambil satu bagian dari hasil JSON, dan `--output text` menghilangkan tanda kutipnya, sehingga hasilnya bisa disimpan ke variabel.

## DynamoDB: database NoSQL

```bash
# Buat tabel dengan primary key "id" bertipe string
awslocal dynamodb create-table \
  --table-name Siswa \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# Simpan data
awslocal dynamodb put-item --table-name Siswa \
  --item '{"id":{"S":"1"},"nama":{"S":"Budi"}}'

# Ambil data berdasarkan key
awslocal dynamodb get-item --table-name Siswa --key '{"id":{"S":"1"}}'
```

`{"S":"Budi"}` berarti nilai `Budi` bertipe string. `put-item` yang berhasil tidak menampilkan apa-apa.

## Bersihkan

```bash
awslocal s3 rb s3://belajar-bucket --force
awslocal sqs delete-queue --queue-url "$QUEUE_URL"
awslocal dynamodb delete-table --table-name Siswa
```

Selanjutnya: [Lambda](03-lambda.md)
