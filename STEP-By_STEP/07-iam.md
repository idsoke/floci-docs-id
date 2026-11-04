# 7. IAM

IAM adalah sistem yang menentukan **siapa boleh melakukan apa**.

Secara default Floci tidak memeriksa izin, sehingga di port 4566 semua request lolos. Karena itu tutorial ini memakai server di **port 4567** dengan pemeriksaan izin aktif. Cara menjalankannya ada di [tutorial 1](01-persiapan.md).

## 1. Siapkan terminal

```bash
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=""
alias iamlocal='aws --endpoint-url=http://localhost:4567'

mkdir -p ~/belajar-iam && cd ~/belajar-iam
```

Kredensial `test` tidak terhubung ke user IAM mana pun, jadi Floci memperlakukannya seperti **admin (root)**.

Buat data contoh:

```bash
iamlocal s3 mb s3://data-sekolah
echo "nilai rapor" > rapor.txt
iamlocal s3 cp rapor.txt s3://data-sekolah/rapor.txt
```

## 2. Buat user tanpa izin

```bash
SITI_ARN=$(iamlocal iam create-user --user-name siti --query User.Arn --output text)

read SITI_KEY SITI_SECRET < <(iamlocal iam create-access-key \
  --user-name siti \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)

siti() {
  AWS_ACCESS_KEY_ID=$SITI_KEY AWS_SECRET_ACCESS_KEY=$SITI_SECRET \
    aws --endpoint-url=http://localhost:4567 "$@"
}

siti sts get-caller-identity
siti s3 ls s3://data-sekolah
```

Fungsi `siti` menjalankan command sebagai Siti. Command terakhir gagal dengan `AccessDenied`, karena **user baru tidak punya izin apa pun**.

## 3. Beri izin baca

```bash
cat > baca-s3.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetObject"],
      "Resource": ["arn:aws:s3:::data-sekolah", "arn:aws:s3:::data-sekolah/*"]
    }
  ]
}
EOF

POLICY_ARN=$(iamlocal iam create-policy \
  --policy-name baca-s3 \
  --policy-document file://baca-s3.json \
  --query Policy.Arn --output text)

iamlocal iam attach-user-policy --user-name siti --policy-arn "$POLICY_ARN"
```

- **`Effect`:** mengizinkan (`Allow`) atau melarang (`Deny`).
- **`Action`:** operasi yang diatur.
- **`Resource`:** targetnya. `s3:ListBucket` berlaku pada bucket, sedangkan `s3:GetObject` pada isinya (`/*`), jadi keduanya perlu ditulis.

Coba lagi:

```bash
siti s3 ls s3://data-sekolah             # berhasil
siti s3 cp s3://data-sekolah/rapor.txt - # berhasil: nilai rapor
siti s3 cp rapor.txt s3://data-sekolah/salinan.txt # AccessDenied
```

Menulis tetap ditolak karena tidak diizinkan. Ini prinsip **least privilege**: beri hanya izin yang dibutuhkan.

## 4. Uji izin tanpa menjalankannya

```bash
iamlocal iam simulate-principal-policy \
  --policy-source-arn "$SITI_ARN" \
  --action-names s3:GetObject s3:PutObject \
  --resource-arns 'arn:aws:s3:::data-sekolah/rapor.txt' \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text
```

Hasilnya:

```text
s3:GetObject    allowed
s3:PutObject    implicitDeny
```

`implicitDeny` berarti ditolak karena tidak ada yang mengizinkan.

## 5. `Deny` selalu menang

```bash
cat > larang.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::data-sekolah/*"
    }
  ]
}
EOF

iamlocal iam put-user-policy --user-name siti --policy-name larang-baca --policy-document file://larang.json
siti s3 cp s3://data-sekolah/rapor.txt -   # gagal: 403 Forbidden

iamlocal iam delete-user-policy --user-name siti --policy-name larang-baca
siti s3 cp s3://data-sekolah/rapor.txt -   # berhasil lagi
```

Walaupun `baca-s3` mengizinkan, `Deny` tetap mengalahkannya. Urutan keputusannya: `Deny` eksplisit, lalu `Allow`, dan kalau tidak ada keduanya berarti ditolak.

## 6. Role: izin yang dipinjam sementara

Berbeda dari user, role tidak punya kunci permanen. Pihak yang dipercaya bisa memakainya sementara, dan role punya dua dokumen:

- **Trust policy:** siapa yang boleh memakai role ini.
- **Permission policy:** apa yang boleh dilakukan role ini.

```bash
cat > kepercayaan.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": "$SITI_ARN"},
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

cat > tulis-s3.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::data-sekolah/*"
    }
  ]
}
EOF

ROLE_ARN=$(iamlocal iam create-role \
  --role-name penulis-data \
  --assume-role-policy-document file://kepercayaan.json \
  --query Role.Arn --output text)

iamlocal iam put-role-policy --role-name penulis-data --policy-name tulis-s3 --policy-document file://tulis-s3.json
```

Siti juga perlu izin untuk memakai role ini:

```bash
cat > boleh-assume.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "$ROLE_ARN"
    }
  ]
}
EOF

iamlocal iam put-user-policy --user-name siti --policy-name boleh-assume --policy-document file://boleh-assume.json
```

Pakai role-nya:

```bash
read R_KEY R_SECRET R_TOKEN < <(siti sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name sesi-siti \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)

peran() {
  AWS_ACCESS_KEY_ID=$R_KEY AWS_SECRET_ACCESS_KEY=$R_SECRET AWS_SESSION_TOKEN=$R_TOKEN \
    aws --endpoint-url=http://localhost:4567 "$@"
}

peran sts get-caller-identity
peran s3 cp rapor.txt s3://data-sekolah/salinan.txt  # berhasil
peran s3 cp s3://data-sekolah/rapor.txt -            # gagal: 403 Forbidden
```

Identitasnya berubah menjadi `assumed-role/penulis-data/sesi-siti`. Selama memakai role, izinnya **hanya izin role itu**, jadi izin baca milik Siti tidak ikut terbawa.

## 7. Trust policy menjaga pintu role

Budi diberi izin `sts:AssumeRole` yang sama, tetapi tidak disebut di trust policy:

```bash
iamlocal iam create-user --user-name budi

read BUDI_KEY BUDI_SECRET < <(iamlocal iam create-access-key \
  --user-name budi \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)

iamlocal iam put-user-policy --user-name budi --policy-name boleh-assume --policy-document file://boleh-assume.json

AWS_ACCESS_KEY_ID=$BUDI_KEY AWS_SECRET_ACCESS_KEY=$BUDI_SECRET \
  aws --endpoint-url=http://localhost:4567 sts assume-role \
  --role-arn "$ROLE_ARN" --role-session-name sesi-budi
```

Hasilnya `AccessDenied`. Izin dari sisi user saja tidak cukup kalau role tidak memercayai user tersebut.

## 8. Inilah arti `--role` di Lambda

`--role` adalah role yang dipakai kode Lambda saat berjalan. Layanan Lambda yang memakainya, jadi `Principal` di trust policy-nya adalah layanan tersebut:

```bash
cat > kepercayaan-lambda.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

LAMBDA_ROLE_ARN=$(iamlocal iam create-role \
  --role-name peran-lambda \
  --assume-role-policy-document file://kepercayaan-lambda.json \
  --query Role.Arn --output text)

cat > baca.py <<'EOF'
import boto3

def lambda_handler(event, context):
    s3 = boto3.client("s3")
    objek = s3.get_object(Bucket="data-sekolah", Key="rapor.txt")
    return {"isi": objek["Body"].read().decode().strip()}
EOF

python3 -m zipfile -c baca.zip baca.py

iamlocal lambda create-function \
  --function-name baca-rapor \
  --runtime python3.12 \
  --role "$LAMBDA_ROLE_ARN" \
  --handler baca.lambda_handler \
  --zip-file fileb://baca.zip \
  --timeout 30

iamlocal lambda wait function-active-v2 --function-name baca-rapor

iamlocal lambda invoke --function-name baca-rapor hasil.json
cat hasil.json
```

Fungsi gagal dengan `AccessDenied`, karena role-nya belum punya izin membaca S3. Tambahkan izinnya tanpa mengubah kode:

```bash
iamlocal iam attach-role-policy --role-name peran-lambda --policy-arn "$POLICY_ARN"

iamlocal lambda invoke --function-name baca-rapor hasil.json
cat hasil.json
```

Hasilnya `{"isi": "nilai rapor"}`. Kode tidak memuat kunci akses sama sekali, karena kredensial sementaranya disediakan otomatis oleh Lambda.

## 9. Bersihkan

Policy harus dilepas dan access key dihapus lebih dulu, baru user atau role bisa dihapus:

```bash
iamlocal lambda delete-function --function-name baca-rapor
iamlocal logs delete-log-group --log-group-name /aws/lambda/baca-rapor
iamlocal iam detach-role-policy --role-name peran-lambda --policy-arn "$POLICY_ARN"
iamlocal iam delete-role --role-name peran-lambda

iamlocal iam delete-role-policy --role-name penulis-data --policy-name tulis-s3
iamlocal iam delete-role --role-name penulis-data

iamlocal iam delete-user-policy --user-name budi --policy-name boleh-assume
iamlocal iam delete-access-key --user-name budi --access-key-id "$BUDI_KEY"
iamlocal iam delete-user --user-name budi

iamlocal iam delete-user-policy --user-name siti --policy-name boleh-assume
iamlocal iam detach-user-policy --user-name siti --policy-arn "$POLICY_ARN"
iamlocal iam delete-access-key --user-name siti --access-key-id "$SITI_KEY"
iamlocal iam delete-user --user-name siti

iamlocal iam delete-policy --policy-arn "$POLICY_ARN"
iamlocal s3 rb s3://data-sekolah --force
```

## Tiga jenis izin

| Jenis | Menjawab | Dipasang pada | Contoh |
|---|---|---|---|
| Identity policy | Identitas ini boleh melakukan apa? | User atau role | `baca-s3` |
| Trust policy | Siapa boleh memakai role ini? | Role | `kepercayaan.json` |
| Resource policy | Siapa boleh mengakses sumber daya ini? | Sumber daya | `lambda add-permission` di [tutorial API Gateway](06-api-gateway.md) |

## Beda Floci dan AWS asli

- **Default izin:** AWS selalu memeriksa izin, sedangkan Floci hanya kalau `FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true`. Lulus di port 4566 belum membuktikan izinnya benar, jadi uji di mode enforcement.
- **`AssumeRole`:** Floci selalu meminta izin `sts:AssumeRole` di sisi user. Sepengetahuan penulis, AWS asli tidak memintanya kalau trust policy di akun yang sama sudah menyebut ARN user secara langsung. Langkah 6 tetap berlaku di keduanya.
- **Role yang belum ada:** di port 4566 kita bisa memakai `--role` yang belum dibuat, sedangkan AWS asli menolaknya.

Selanjutnya: [Latihan akhir](08-latihan-akhir.md)
