# v13

- İnceleme, onay ve hesaplama verileri kişi kimliği + yıl bazında ayrıldı.
- Yeni arama/kişi seçiminde önceki kişinin listesi gizleniyor; yalnızca seçili kişinin kayıtları gösteriliyor.
- Geç gelen API ve HTML yanıtları iptal/bağlam kontrolüyle eleniyor. Yanlış kimlikli kaynak yanıtları birleştirilmiyor.
- Eski karışık listeler kaynak kimliğiyle ayrılıyor; kimliği bilinmeyen eski kayıtlar başka kişiye otomatik taşınmıyor.
- Kişiye geri dönme, yıl değiştirme ve yedek geri yüklemede kişi ayrımı korunuyor.
- Aynı ad/soyadı veya eser anahtarı farklı kişilerin onay ve puanlarını paylaşmasına yol açmıyor.

# v12

- Ön incelemede en az bir ön onaylı ve eksiksiz kayıt varsa hesaplamaya dahil etme düğmesi etkinleşir.
- Eksik bilgili ve ön onaysız kayıtlar hesaplamayı engellemez; silinmeden incelemede tutulur.
- Geçersiz eski ön onaylar tekrar kontrol edilip atlanır; geçerli ön onaylı kayıtlar hesaplanır.
- Eklenen kayıt sayısı, toplam puan ve incelemede kalan kayıt sayısı pop-up'ta gösterilir. Eksik kayıt kalırsa pencere açık kalır.
- Eksikler tamamlanıp yeniden onaylandığında yalnızca yeni hazır kayıtlar eklenir; önceki kayıtlar çift sayılmaz.

# v11

- Profil seçiminden hemen sonra SSCI, SCI/SCI-E, AHCI ve SCOPUS yayın sayıları gösteriliyor.
- Tüm yıllardaki makale, bildiri ve kitap kayıtları sayılıyor; editörlük, proje ve ödül özet sayımına katılmıyor.
- Aynı kayıt bir indeks içinde tekilleştiriliyor; farklı indekslerde açıkça işaretlenmişse her ilgili kartta sayılıyor.
- Özet tam faaliyet aktarımından bağımsızdır ve puanlamayı etkilemez.
- Hemen yükleniyor durumu, geç yanıt koruması, hata/kısmi veri/sıfır ayrımı, 5 dakikalık kısa önbellek ve yenileme eklendi.
- Ham profil paneli geri eklenmedi; kapsam beş faaliyet türü olarak korunuyor.

# v10

- Ön profil paneli ve ham profil bilgileri kaldırıldı.
- Hazır kişisel profil/veri örneği paketten kaldırıldı.
- Arama ve kişi seçiminden sonra aktarım yalnızca MAKALE, BİLDİRİ, KİTAP, PROJELER ve ÖDÜLLER ile sınırlandı.
- Diğer bölüm istekleri, editörlük/hakemlik filtreleri ve profil istatistik çağrısı kaldırıldı.
- Eski kayıtlı yıllardaki ve geri yüklenen yedeklerdeki ham profil metni ile kapsam dışı inceleme kayıtları temizleniyor.
- Sunucu, HTML aktarımı ve arayüz aynı beş kategori sınırını uyguluyor.
- Mevcut hesaplama kayıtları, pop-up incelemesi, toplu ön onay, ayrı hesaplamaya dahil etme ve büyük artı/eksi düğmeleri korunuyor.
