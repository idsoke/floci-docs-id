# 1. Persiapan dan Menjalankan Floci

Semua command dijalankan di terminal WSL.

## Yang dibutuhkan

| Kebutuhan | Keterangan |
|---|---|
| JDK 25 | Floci butuh Java 25. Di komputer ini tersedia lewat SDKMAN, walaupun default-nya Java 21 |
| Docker | Wajib untuk Lambda, karena fungsi berjalan di dalam container |
| AWS CLI | Dipasang dengan `uv` |
| `uv` dan Python | Untuk memasang AWS CLI dan membuat file zip |

## 1. Ambil kode terbaru

```bash
cd ~/floci
git pull --ff-only
```

## 2. Build Floci

```bash
cd ~/floci
export JAVA_HOME=~/.sdkman/candidates/java/25.0.5.0+8-tem
export PATH=$JAVA_HOME/bin:$PATH
./mvnw -q clean package -DskipTests
```

Ulangi build setiap kali kode Floci diperbarui.

## 3. Pasang AWS CLI

```bash
uv tool install awscli
aws --version
```

## 4. Jalankan server

Buka terminal terpisah, karena server terus berjalan di terminal tersebut.

```bash
cd ~/floci
~/.sdkman/candidates/java/25.0.5.0+8-tem/bin/java -jar target/quarkus-app/quarkus-run.jar
```

Cek statusnya dari terminal lain:

```bash
curl http://localhost:4566/_floci/health
```

Server ini dipakai untuk tutorial 2 sampai 6.

## 5. Jalankan server dengan pemeriksaan izin

Tutorial 7 dan 8 butuh server kedua. Jalankan di terminal terpisah lagi:

```bash
cd ~/floci
FLOCI_PORT=4567 FLOCI_BASE_URL=http://localhost:4567 FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true \
  ~/.sdkman/candidates/java/25.0.5.0+8-tem/bin/java -jar target/quarkus-app/quarkus-run.jar
```

Hentikan server dengan `Ctrl+C` di terminalnya.

## 6. Siapkan terminal kerja

Jalankan ini di setiap terminal baru:

```bash
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=""
alias awslocal='aws --endpoint-url=http://localhost:4566'
alias iamlocal='aws --endpoint-url=http://localhost:4567'
```

Kredensial `test` hanya kredensial palsu untuk Floci.

## Jangan pakai `aws` saja

Tanpa `--endpoint-url`, command dikirim ke AWS asli. Variabel `AWS_ENDPOINT_URL` juga tidak cukup, karena AWS CLI versi 1 mengabaikannya untuk SQS. Gejalanya adalah S3 dan DynamoDB jalan normal, tetapi SQS gagal dengan error ini:

```text
InvalidClientTokenId: The security token included in the request is invalid.
```

Error itu berasal dari AWS asli yang menolak kredensial palsu. Karena itu, selalu pakai alias `awslocal` atau `iamlocal`.

Selanjutnya: [S3, SQS, dan DynamoDB](02-s3-sqs-dynamodb.md)
