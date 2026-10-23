# Akademik Teşvik Puanı Hesaplama (GitHub Pages)

Hedef yayın adresi: **https://akademiktesvik.yasinkutuk.com/**

Bu dosyalar yeni bir GitHub deposunun **kök dizinine** yüklenmelidir.
Mevcut `yasinkutuk/yasinkutuk.github.io` deposunu değiştirmeyin.

## Kurulum

1. GitHub’da `yasinkutuk` hesabında `akademiktesvik` adlı **Public** depo oluşturun.
2. Bu ZIP içindeki dosyaları (`index.html`, `styles.css`, `engine.js`, `app.js`, `CNAME`, `.nojekyll`) yeni deponun **köküne** yükleyip commit edin. ZIP dosyasını tek bir dosya olarak yüklemeyin.
3. Depo **Settings → Pages → Build and deployment** altında Source = **Deploy from a branch**, Branch = **main**, Folder = **/(root)** seçin ve kaydedin.
4. Aynı Pages bölümünde **Custom domain** = `akademiktesvik.yasinkutuk.com` yazıp Save deyin (bu aşamayı DNS eklemeden önce yapın).
5. DNS yönettiğiniz hizmette (ör. Cloudflare), yalnızca bu alt alan adı için bir kayıt ekleyin:

   | Type | Name | Target |
   |---|---|---|
   | CNAME | akademiktesvik | yasinkutuk.github.io |

   Cloudflare kullanıyorsanız ilk kurulum ve GitHub doğrulaması için `DNS only` (gri bulut) seçin. Kaydı `yasinkutuk.com` adresine ya da `yasinkutuk.github.io/akademiktesvik` URL'sine yönlendirmeyin.
6. DNS doğrulaması başarılı olunca GitHub Pages ayarlarında **Enforce HTTPS** seçeneğini etkinleştirin.

GitHub Pages kaynakları: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

### Notlar

- Mevcut `yasinkutuk.com` ve `www.yasinkutuk.com` yapılandırmalarına müdahale edilmez.
- Başlangıçta 404 veya HTTPS sertifika beklemesi normal olabilir; DNS yayılımı bazen 24 saat alabilir.
- Bu uygulama statiktir: sunucu kodu, veritabanı, Docker ve ücretli barındırma gerekmez.
- Tarayıcı verileri kullanıcının kendi cihazında saklanır.
- Bu paketin varlığı GitHub'a yükleme veya DNS değişikliği yapıldığı anlamına gelmez.
