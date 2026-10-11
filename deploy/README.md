# Distro Pro — bulut serverga joylash (Oracle Cloud Always Free)

## 1. Oracle'da server ochish (o'zingiz)
1. cloud.oracle.com → **Start for free** → ro'yxatdan o'ting (karta faqat tasdiqlash uchun).
2. Hisobni **Pay As You Go** ga o'tkazing va **Budgets** da 1 $ lik ogohlantirish qo'ying
   (shunda bo'sh turgan server o'chirilmaydi, bepul chegara ichida pul olinmaydi).
3. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 24.04** (yoki 22.04)
   - Shape: **Ampere VM.Standard.A1.Flex**, 1 OCPU, **2 GB** xotira (Always Free)
   - SSH keys: **Paste public key** → `C:\Users\user\.ssh\distro_oracle.pub` ichidagi qator
4. Instance sahifasida **Public IP** ni yozib oling.
5. **Networking → Virtual cloud networks → (VCN) → Security Lists → Default** → **Add Ingress Rules**:
   Source `0.0.0.0/0`, TCP, Destination port **80** va **443**.

## 2. Serverni tayyorlash (bir marta)
```
scp -i %USERPROFILE%\.ssh\distro_oracle deploy\server-setup.sh ubuntu@IP:~
ssh -i %USERPROFILE%\.ssh\distro_oracle ubuntu@IP "bash server-setup.sh IP-NUQTALARSIZ.sslip.io"
```
Domen: IP `141.147.10.20` bo'lsa → `141-147-10-20.sslip.io` (bepul, ro'yxatsiz, HTTPS avtomatik).

## 3. Dastur va bazani ko'chirish
```
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server ubuntu@IP -MigrateData
```
Bu kompyuterdagi serverni to'xtatadi va avtomatik ishga tushishini o'chiradi (ma'lumot bitta joyda bo'lishi uchun),
bazani va maxfiy kalitni ko'chiradi, jadvallardagi qatorlar sonini solishtiradi. Kompyuterdagi baza fayli o'zgarmaydi.

Keyingi kod yangilanishlari (baza serverda qoladi):
```
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server ubuntu@IP
```

## 4. Kunlik zaxira nusxa kompyuterga
```
powershell -ExecutionPolicy Bypass -File deploy\install-backup-task.ps1 -Server ubuntu@IP
```

## Foydali buyruqlar (serverda)
- Holat: `sudo systemctl status distro-pro`
- Jurnal: `sudo journalctl -u distro-pro -n 100`
- Qayta ishga tushirish: `sudo systemctl restart distro-pro`
