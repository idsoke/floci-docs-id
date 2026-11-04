# Belajar AWS dengan Floci: Step by Step

Tutorial ini mengajarkan command AWS CLI dari dasar sampai membuat satu aplikasi kecil, memakai Floci sebagai emulator AWS lokal. Semua berjalan di komputer sendiri, tanpa akun AWS dan tanpa biaya.

## Urutan belajar

| No | File | Isi |
|---|---|---|
| 1 | [Persiapan dan menjalankan Floci](01-persiapan.md) | Build, menjalankan server, dan menyiapkan terminal |
| 2 | [S3, SQS, dan DynamoDB](02-s3-sqs-dynamodb.md) | Pola command dan tiga layanan dasar |
| 3 | [Lambda](03-lambda.md) | Membuat, memanggil, memperbarui, dan membaca log fungsi |
| 4 | [Lambda dipicu SQS](04-lambda-sqs.md) | Fungsi jalan otomatis saat ada pesan masuk |
| 5 | [Dead-letter queue](05-dead-letter-queue.md) | Menangani pesan yang terus gagal |
| 6 | [API Gateway](06-api-gateway.md) | Memanggil Lambda lewat URL HTTP |
| 7 | [IAM](07-iam.md) | User, policy, role, dan pemeriksaan izin |
| 8 | [Latihan akhir](08-latihan-akhir.md) | Menggabungkan semua layanan menjadi satu aplikasi |

## Dua server yang dipakai

| Port | Pemeriksaan izin IAM | Dipakai di | Alias |
|---|---|---|---|
| 4566 | Tidak aktif | Tutorial 2 sampai 6 | `awslocal` |
| 4567 | Aktif | Tutorial 7 dan 8 | `iamlocal` |

Kedua server menyimpan data di memori, jadi data hilang saat server berhenti.

## Versi saat tutorial diuji

Semua command sudah dijalankan pada November 2026 dengan:

- Floci 2.4.0, dari commit `1d6ec2b9d`
- AWS CLI 1.46.2 (versi 1)
- JDK 25 dan Python runtime Lambda 3.12
- Windows dengan WSL2

Sebagian command berbeda di AWS CLI versi 2. Perbedaannya dicatat di [tutorial Lambda](03-lambda.md).

## Peringatan terpenting

Selalu pakai `awslocal` atau `iamlocal`, bukan `aws` saja. Tanpa `--endpoint-url`, command dikirim ke AWS asli. Variabel `AWS_ENDPOINT_URL` juga tidak cukup, karena AWS CLI versi 1 mengabaikannya untuk SQS.
