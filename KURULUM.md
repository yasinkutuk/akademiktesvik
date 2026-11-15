# Akademik Teşvik v13 — beş faaliyet türü

## Kurulum ve güncelleme

Python 3.10 veya üzeri gerekir. ZIP'i açıp `akademiktesvik` klasöründe:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Windows'ta sanal ortamı `.venv\Scripts\activate` ile etkinleştirin. http://127.0.0.1:8000 adresini açın. Güncellemeden önce mevcut hesaplamanızı **Yedekle** ile koruyun; çalışan sunucuyu durdurup yeni klasörden başlatın. Aynı tarayıcı ve adres yıl bazlı önceki kayıtları okur.

## Kişiye özel inceleme ve hesaplama

İnceleme, onaylar, eksik kayıtlar ve hesaplama **authorGuidId/authorId + faaliyet yılı** ile ayrı saklanır. Aynı ad/soyadı taşıyan kişiler isimle değil YÖK kimliğiyle ayrılır. Kişi seçince yalnızca o kişinin ilgili yıldaki çalışması açılır. Önceki kişiye dönerseniz onun taslağı ve puanları ayrı olarak geri gelir.

Yeni arama yapıldığında veya profil bağlantısı düzenlenirken eski inceleme penceresi kapatılır ve eski liste gizlenir. Kişi seçilene kadar eski kayıtlar onaylanamaz. Bir önceki kişinin API/HTML yanıtı geç gelse bile yeni listeye eklenmez; dönen kimlik/kaynak başka kişiye aitse yanıt reddedilir. Kişi değiştirildiğinde eski kişiye ait HTML dosyası seçimi de temizlenir.

Eski sürümün aynı yıla ait karışık kayıtlarından yalnızca kaynak bağlantısı veya sahip kimliği seçilen kişiyle eşleşenler aktarılır. Ad benzerliği sahiplik kanıtı sayılmaz. Kişiye bağlanamayan eski manuel kayıtlar eski yıl alanında korunur ve başka kişinin hesabına kendiliğinden taşınmaz. Daha önce alınmış yedeğinizi saklayın. Yeni yedekler kişi kimliğini içerir; kişisi bilinen yedeği geri yüklemek ilgili kişinin çalışma alanını açar. Faaliyet yılını geri yüklemeden önce doğru seçin.

## Hızlı yayın özeti

İsimle arayıp **Bu profili seç** düğmesine bastığınızda SSCI, SCI/SCI-E, AHCI ve SCOPUS kartları otomatik yüklenir. Doğrudan profil bağlantısını yazıp alandan çıktığınızda da aynı özet alınır. Bu işlem tam faaliyet aktarımından bağımsızdır; proje, ödül veya yayın ayrıntılarının tamamlanmasını beklemez. İnceleme listesine kayıt veya puan eklemez.

Özet **tüm yıllardaki makale, bildiri ve kitap/bölüm** kayıtlarını kapsar. Editörlükler dahil edilmez. SCI kartı SCI, SCI-E, SCIE ve SCI-Expanded adlarını birleştirir. Yalnızca kaynağın yayın türü/endeks alanındaki açık bilgiler kullanılır; başlık, dergi adı veya başka bir indeksin varlığından SSCI/SCI/AHCI/SCOPUS üyeliği varsayılmaz. Aynı yayın birden fazla indekste açıkça yer alıyorsa ilgili kartlarda ayrı ayrı sayılır; kartları toplamak benzersiz yayın sayısını vermez. Diğer indekste olan veya bu dört indeksi açıkça belirtilmeyen kayıtların sayısı da açıklanır.

Kişi değiştirildiğinde eski sayılar hemen temizlenir ve önceki isteğin geç yanıtı gösterilmez. Erişim hatası, zaman aşımı veya bozuk veri sıfır sayı olarak sunulmaz. Kısmi veride eksiklik uyarısı gösterilir. Gerçek boş listede sıfır gösterilir. **Yenile** güncel veriyi yeniden ister.

Tamamlanmış özetler tekrar seçimleri hızlandırmak için sunucu belleğinde en çok 5 dakika tutulur; yalnızca sayılar, kapsam ve seçilen kişinin adı/bağlantısı saklanır. Ham profil metni veya yayın listesi bu önbelleğe alınmaz. Yenile önbelleği atlar. Özet tarayıcının hesaplama yedeğine kaydedilmez. Kaynak sunucu hızı/erişimi özetin tamamlanma süresini etkileyebilir.

## Aktarım kapsamı

İsimle arayıp doğru kişiyi seçin veya `https://akademik.yok.gov.tr/academician-details?authorGuidId=…` bağlantısını girin. Faaliyet yılını seçip **Beş faaliyet türünü getir** düğmesine basın.

| Çekilen bölüm | İnceleme bilgileri |
|---|---|
| MAKALE | Künye, yazar sayısı, endeks ve varsa yayın yılına ait JIF Q önerisi |
| BİLDİRİ | Künye, yazar sayısı ve tam metin/sözlü sunum uygunluğu |
| KİTAP | Kitap veya bölüm künyesi, yazar sayısı, yayınevi ve ISBN |
| PROJELER | Proje türü, sonuçlanma yılı, ilgili akademisyenin görevi ve gerekli destek bilgileri |
| ÖDÜLLER | Ödül türü, yılı, veren kurum ve uygunluk bilgileri |

Kişiyi doğru seçmek ve kimliği doğrulamak için ad ve profil bağlantısı kullanılır. Ön profil paneli, biyografi/iletişim/öğrenim/görev özeti veya ham profil metni aktarım sonucunda saklanmaz. Diğer faaliyet bölümlerine ve profil istatistik servisine istek gönderilmez. Yeni yayın türü listesinde diğer türler bulunsa bile yalnızca MAKALE, BİLDİRİ ve KİTAP filtreleri çağrılır.

Kaynakta tüm yılların kayıtları listelenir; yalnızca seçilen yılın uygun kayıtları puanlanabilir. Ayrıntı uç noktası seçilen yılın yayınları için okunur. Açık yazar sayısı yoksa kişi sayısı varsayılmaz. Q önerisi yalnızca aynı yayın yılının tutarlı JIF verisinden yapılır; JCI ve başka yıl Q'su kullanılmaz. Proje görevi doğru authorGuidId ile eşleştirilir; geçen takvim süresi destek süresi varsayılmaz.

## Pop-up ve onay

1. Kaynak künyesini ve gerekli faaliyet alanlarını inceleyin. Uygun olmayanları **Hariç tut** ile ayırın.
2. **Tümüne onay ver** ile topluca ön onay verin. Eksik alanlar ilgili kayıtta belirtilir. Yılı belirsiz bir kaydın yılını ayrıca kaynaktan doğrulayın. Bu aşama puanı değiştirmez.
3. **Ön onaylıları hesaplamaya dahil et (N)** düğmesi, en az bir ön onaylı ve eksiksiz kayıt varsa etkinleşir. Yalnızca bu hazır kayıtlar hesaplanır. Diğer kayıtlarda eksik bilgi veya ön onay eksikliği bulunması hesaplamayı engellemez; bunları hariç tutmak veya silmek zorunda değilsiniz. Eksik/ön onaysız kayıtlar puana alınmaz ve inceleme listesinde korunur. Kayıt bilgileri son aşamada tekrar kontrol edilir; ön onaylı görünmesine rağmen geçersizleşmiş bir kayıt da atlanıp yeniden incelemeye açılır.
4. Hesaplama sonrası eklenen kayıt sayısı, güncel toplam puan ve incelemede bırakılan kayıt sayısı gösterilir. Eksik kayıt kalırsa pencere açık kalır; tamamlayıp yeniden ön onay vererek sonradan ekleyebilirsiniz. Daha önce eklenen kayıtlar tekrar sayılmaz. Pencereyi kapatmak, Escape veya daha sonra devam etme yeni kayıt eklemez; yapılmış hesaplama ve taslaklar saklanır.

Özet bildiriler ve tamamlandığı doğrulanmayan projeler uygun tam metin/sonuçlanmış faaliyet olarak otomatik puanlanmaz. Yayınevi tanınırlığı, makale türü, bildiri koşulları ve ödül uygunluğu kullanıcı tarafından kontrol edilir. Mevcut hesaplama motoru korunur; geçmiş yıl mevzuatı otomatik seçilmez. Unvan, bilim alanı ve ödeme katsayısını kendiniz doğrulayın.

Bütün sayı alanlarında solda büyük eksi, sağda büyük artı vardır; klavyeyle giriş ve sayı sınırları korunur.

## Önceki sürüm kayıtlarının temizlenmesi

Uygulama açıldığında tarayıcıdaki kayıtlı yıllardan eski ham profil metni ve kapsam dışındaki inceleme/bölüm kayıtları kaldırılır. Yedek geri yüklemede de aynı kapsam temizliği uygulanır. Eski veriler silinmez; doğrulanmış sahiplik olmadan başka kişinin çalışma alanına taşınmaz. Güncel pakette hazır kişisel profil/veri dosyası bulunmaz.

## Alternatif HTML aktarımı

Kaydedilmiş HTML dosyaları alternatifinden de yalnızca yukarıdaki beş tür kabul edilir. Her dosya için ilgili türü seçin ve ad/soyadı girin. Profil HTML'si ve diğer bölüm türleri kabul edilmez. HTML içinde gerçek tablolu kayıt bulunmalıdır; yeni sitenin yalnızca JavaScript iskeletini içeren sayfası veri olarak kabul edilmez. Dosyalar aynı inceleme/onay akışına alınır.

## Kontroller ve sınırlar

Kaynak listeleri 1'den başlayan sayfalama ile alınır; her bölümün kendi `totalElements` ve `totalPages` bilgileri kontrol edilir. Sıfır satırla pozitif toplam, tekrar eden sayfa veya sonraki sayfa hatası tam aktarım sayılmaz. Bölüm başına 50 sayfa ve yaklaşık 240 saniyelik toplam süre sınırı vardır. Hatalı/eksik bölümler açıkça belirtilir.

Künye kayıt başına 6.000, kaynak metni bölüm başına 60.000 karakter ve inceleme listesi yıl başına 5.000 kayıtla sınırlıdır. Yedekler 50 MB'a kadar kabul edilir; tarayıcı yerel depolama kotası daha düşük olabilir. Kaydetme göstergesini kontrol edin.

```bash
python -m unittest discover -s tests -v
node --check app.js
node --check engine.js
node tests/test_engine.js
```

İsteğe bağlı DOM testleri için jsdom kurup `JSDOM_PATH` modül yoluyla `node tests/test_ui.cjs`, `node tests/test_profile_ui.cjs` , `node tests/test_modern_ui.cjs` ve `node tests/test_summary_ui.cjs` çalıştırın. Bu bağımlılıklar normal kullanım için gerekli değildir. Eksik kayıtları atlayarak hesaplama kontrolü için ayrıca `node tests/test_partial_review_ui.cjs` çalıştırabilirsiniz. Kontroller, beş kategoriye istek sınırını, ön profil temizliğini, kapsam dışı yanıtların elenmesini ve iki aşamalı onayı doğrular.

Otomatik aktarım Python sunucusu gerektirir; GitHub Pages tek başına yeterli değildir. Varsayılan sunucu yalnızca `127.0.0.1:8000` dinler. Bu ZIP mevcut canlı sitenize veya GitHub/DNS ayarlarınıza değişiklik göndermez.

## v11 doğrulaması

83 Python testi ve motor/DOM arayüz kontrolleri; indeks eşleştirme, SSCI/SCI ayrımı, örtüşme/tekilleştirme, yalnızca üç yayın türünün sayılması, önbellek/yenileme, profil değiştirme yarışları, hata ile gerçek sıfırın ayrımı ve puan izolasyonunu kontrol eder. Canlı özet isteği bu oturumda YÖK bağlantısı zaman aşımıyla sonuçlandı; canlı güncel sayılar bu sürüm için ayrıca doğrulanamadı. Gerçek Chromium görsel testi tamamlanmış değildir.

## v12 onay ve hesaplama doğrulaması

DOM kontrollerinde tek bir ön onaylı kayıt varken diğer üç eksik/ön onaysız kaydı incelemede bırakarak hesaplama, tam doldurulmuş ama ön onay almamış taslağın eklenmemesi, geçersiz eski ön onayın atlanması, yenilemede kayıt kalıcılığı ve tamamlanan kayıtların sonradan çift sayılmadan eklenmesi doğrulandı. Hesaplanacak hazır alt küme kendi içinde doğrulanır; hesaplama motoru düzeyinde bir hata olursa bu alt kümeye ekleme yapılmaz.

## v13 kişi ayrımı kontrolü

Aynı adı ve aynı eser anahtarını kullanan iki kişi, kişi/yıl geçişi, eski karışık kayıtların ayrılması, arama başladığında eski listenin gizlenmesi, geç API/HTML yanıtları, yanlış kimlikli yanıtın reddi, yeniden açılış ve başka kişiye ait yedeğin doğru alana yüklenmesi DOM testlerinde kontrol edilir: `node tests/test_person_isolation_ui.cjs`. Diğer mevcut inceleme, kısmi hesaplama ve yayın özeti kontrolleri de korunmuştur.
