# Akademik Teşvik v13

“Bu profili seç” düğmesinden hemen sonra yayın özeti açılır. Tüm yıllardaki makale, bildiri ve kitap kayıtlarında açıkça belirtilen **SSCI, SCI/SCI-E, AHCI ve SCOPUS** sayıları gösterilir. Özet puanı değiştirmez ve tam faaliyet aktarımını beklemez.

Bir akademisyen arandıktan/seçildikten sonra yalnızca beş faaliyet türü aktarılır:

- MAKALE
- BİLDİRİ
- KİTAP / KİTAP BÖLÜMÜ
- PROJELER
- ÖDÜLLER

Ön profil bilgileri ve hazır kişisel veri örneği kaldırıldı. Profil özeti, ham profil metni ve kapsam dışındaki faaliyetler inceleme penceresinde gösterilmez. Önceki sürümün kaydettiği profil metni ve kapsam dışı inceleme kayıtları, uygulama açılışında yıl bazlı kayıtlardan temizlenir. Kayıtlar kişi kimliği ve yıl birlikte esas alınarak ayrı saklanır. Kişi değişince önceki kişinin incelemesi, onayları ve puanları yeni kişiye taşınmaz. Eski veriler cihazda korunur; kişisi doğrulanamayan kayıtlar yeni hesaba otomatik eklenmez.

**İnceleme → Tümüne onay ver → Ön onaylıları hesaplamaya dahil et** akışı ve büyük artı/eksi düğmeleri korunur. Veriler onaysız puanlanmaz. Ön onaylı ve eksiksiz kayıtlar, diğerleri eksik veya onaysız olsa da hesaplanabilir. Eksik kayıtlar silinmez; incelemede kalır ve tamamlandıktan sonra ayrıca eklenebilir.

```bash
pip install -r requirements.txt
python server.py
```

Python 3.10+ gerekir. http://127.0.0.1:8000 adresini açın. Kurulum ve kullanım: [KURULUM.md](KURULUM.md).
