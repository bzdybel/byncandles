/**
 * by N. candles - WSZYSTKIE teksty interfejsu w jednym pliku (język: polski).
 *
 * Zasady:
 * - Każda przestrzeń nazw to osobny eksport nazwany - skrypty w przeglądarce importują tylko to,
 *   czego potrzebują (np. `cart`), więc reszta tekstów nie trafia do paczki JS.
 * - Zmienne w tekstach: {nazwa} - wypełniane przez `fill()` z `src/lib/i18n.ts`.
 * - Odmiana liczebników: krotka [1, 2-4, 5+] - używana przez `plural()`.
 * - Fragmenty z wyróżnieniem (kursywa) są rozbite na części: `title` + `titleEm`.
 * - Treści produktów, kategorii i ustawień sklepu pochodzą z panelu Keystatic, nie stąd.
 */

export const brand = {
  name: 'by N. candles',
  author: 'Natalia',
  description:
    'Ręcznie robione świece z wosku sojowego i pszczelego - róże, muszle, krówki i inne małe rzeźby. Tworzy Natalia.',
  tagline: 'wosk sojowy i pszczeli · rękodzieło',
  logoMark: 'by N.',
  logoSub: 'candles',
  homeLabel: '{name} - strona główna',
} as const;

export const common = {
  skipLink: 'Przejdź do treści',
  breadcrumbs: 'Okruszki',
  instagramHandle: '@by_n.candles',
  instagramCta: 'Napisz na Instagramie',
  openInstagram: 'Otwórz Instagram',
  goToShop: 'Przejdź do sklepu',
  seeCollection: 'Zobacz kolekcję',
  seeCandles: 'Zobacz świece',
  customOrder: 'Zamówienie indywidualne',
  readMore: 'Przeczytaj więcej',
  priceRegular: 'Cena regularna ',
  pricePromo: 'Cena promocyjna ',
} as const;

export const nav = {
  label: 'Główna nawigacja',
  shop: 'Sklep',
  contact: 'Kontakt',
} as const;

export const footer = {
  intro: 'Ręcznie robione świece z wosku sojowego i pszczelego. Tworzy {author}.',
  shop: 'Sklep',
  info: 'Informacje',
  follow: 'Obserwuj',
  allCandles: 'Wszystkie świece',
  delivery: 'Dostawa i zwroty',
  customOrders: 'Zamówienia indywidualne',
  contact: 'Kontakt',
  terms: 'Regulamin',
  privacy: 'Polityka prywatności',
  instagram: 'Instagram {handle}',
  instagramStrip: 'Obserwuj {handle}',
  carouselLabel: 'Zdjęcia z Instagrama',
  carouselPrev: 'Poprzednie zdjęcia',
  carouselNext: 'Następne zdjęcia',
  copyright: '© {year} {name} · {tagline}',
} as const;

export const status = {
  dostepny: 'Dostępny',
  wkrotce: 'Wkrótce',
  wyprzedany: 'Wyprzedany',
  ukryty: 'Ukryty',
  promo: 'Promocja',
} as const;

export const wax = {
  sojowy: 'sojowy',
  pszczeli: 'pszczeli (100%)',
  sojowoPszczeli: 'sojowy z dodatkiem pszczelego',
  rzepakowy: 'rzepakowy',
  kokosowy: 'kokosowy',
  mieszanka: 'mieszanka wosków',
  inny: 'inny',
} as const;

export const home = {
  metaTitle: 'Ręcznie robione świece sojowe i z wosku pszczelego',
  metaDescription:
    'by N. candles - ręcznie odlewane świece z wosku sojowego i pszczelego: róże, muszle, krówki Highland i inne małe rzeźby. Idealne na prezent.',
  heroTitle: 'Ręcznie robione świece z wosku sojowego i pszczelego',
  heroQuote:
    '„Każda świeca powstaje ręcznie. Od roztapiania wosku, przez mieszanie zapachu, aż po ostatnie detale. Ten cały proces to coś, co pozwala mi zwolnić tempo i skupić się na «tu» i «teraz»”.',
  heroSignature: 'Natalia',
  featured: 'Wybrane świece',
  featuredMore: 'Cała kolekcja',
  processTitle: 'Jak powstaje świeca',
  processTitleEm: 'by N.',
  processSteps: [
    { title: 'Knot i forma', text: 'Każdą formę przygotowuję ręcznie - knot musi stać idealnie pośrodku, żeby świeca paliła się równo.' },
    { title: 'Wosk i zapach', text: 'Roztapiam wosk sojowy lub pszczeli i dodaję olejek zapachowy, odmierzany co do kropli.' },
    { title: 'Odlewanie', text: 'Wosk wlewam powoli do formy. Potem świeca musi spokojnie zastygnąć - tego etapu nie da się przyspieszyć.' },
  ],
  galleryOverline: 'Moje prace',
  galleryMore: 'Więcej na Instagramie',
  materialsTitle: 'Z czego powstają świece',
  materialsTitleEm: 'by N.',
  materials: [
    {
      title: 'Wosk sojowy',
      text: 'Roślinny, czysto palący się wosk, który świetnie oddaje detale formy - od żłobień muszli po płatki róż. Część świec łączę z dodatkiem wosku pszczelego dla głębszego koloru.',
    },
    {
      title: 'Wosk pszczeli z lokalnej pasieki',
      text: 'Świece w 100% z naturalnego wosku pszczelego, bez zbędnych dodatków - tylko piękny, miodowy kolor i charakterystyczny, delikatny zapach miodu.',
    },
  ],
  giftTitle: 'Na prezent i',
  giftTitleEm: 'na zamówienie',
  giftText: [
    'Świece pakuję w różowe pudełka z okienkiem albo w celofan przewiązany sznurkiem - gotowe do wręczenia.',
    'Szukasz czegoś wyjątkowego? Przygotowuję też zamówienia indywidualne: wybrany kolor, zapach albo zestaw na prezent dla bliskiej osoby.',
  ],
  giftCta: 'Zapytaj o zamówienie',
  giftSecondary: 'Wybierz ze sklepu',
} as const;


export const contact = {
  metaTitle: 'Kontakt i zamówienia indywidualne',
  metaDescription: 'Napisz do by N. candles - pytania o świece, zamówienia indywidualne, zestawy na prezent i współpraca.',
  title: 'Napisz',
  titleEm: 'do mnie',
  lead: 'Masz pytanie o świecę, chcesz zamówić coś specjalnego albo przygotować zestaw na prezent? Odpiszę i pomogę wybrać.',
  fastest: 'Najszybciej',
  instagramMessage: 'Wiadomość na Instagramie',
  email: 'E-mail',
  customTitle: 'Zamówienia indywidualne',
  customText:
    'Wybrany kolor, zapach, forma albo zestaw kilku świec w prezentowym pudełku - napisz, czego szukasz i na kiedy. Dobrze, jeśli podasz też budżet; wtedy od razu zaproponuję konkretne rozwiązanie.',
} as const;

export const delivery = {
  metaTitle: 'Dostawa i zwroty',
  metaDescription: 'Wysyłka świec by N. do Paczkomatów InPost, bezpieczne pakowanie i 14 dni na odstąpienie od umowy.',
  title: 'Dostawa i zwroty',
  lead: 'Świece wysyłam starannie zapakowane, żeby dotarły w idealnym stanie - także te o delikatnych, rzeźbionych kształtach.',
  shippingTitle: 'Dostawa',
  locker: 'Paczkomat InPost',
  courier: 'Kurier InPost',
  freeShipping: 'Darmowa dostawa',
  freeFrom: 'od {price}',
  costInCart: 'koszt podany w koszyku',
  tracking: 'Po nadaniu paczki dostaniesz od InPost wiadomość z numerem do śledzenia przesyłki.',
  packingTitle: 'Pakowanie',
  packingText:
    'Każda świeca jest zabezpieczona przed transportem. Na życzenie pakuję ją prezentowo - w różowe pudełko z okienkiem lub w celofan ze sznurkiem. Napisz o tym w uwagach do zamówienia.',
  returnTitle: 'Zwrot (odstąpienie od umowy)',
  returnText: [
    'Kupując jako konsument, możesz odstąpić od umowy bez podawania przyczyny w ciągu 14 dni od otrzymania paczki. Wystarczy, że w tym czasie poinformujesz mnie o swojej decyzji (np. wiadomością), a następnie odeślesz świecę w stanie nienaruszonym.',
    'Zwrócę płatność za produkt i najtańszy oferowany sposób dostawy w ciągu 14 dni od otrzymania informacji o odstąpieniu. Koszt odesłania świecy pokrywa kupujący.',
  ],
  returnException:
    'Wyjątek stanowią świece wykonane na indywidualne zamówienie według Twojej specyfikacji - w ich przypadku prawo odstąpienia od umowy nie przysługuje.',
  complaintTitle: 'Reklamacje',
  complaintBefore: 'Jeśli świeca dotrze uszkodzona lub ma wadę, napisz do mnie - najlepiej ze zdjęciem. Każdą sprawę rozpatrzę w ciągu 14 dni. Szczegóły znajdziesz w ',
  complaintLink: 'regulaminie',
  question: 'Masz pytanie? Napisz',
} as const;

export const legal = {
  terms: 'Regulamin sklepu',
  termsDescription: 'Regulamin sklepu internetowego by N. candles.',
  privacy: 'Polityka prywatności',
  privacyDescription: 'Polityka prywatności i informacje o przetwarzaniu danych osobowych w by N. candles.',
  pending: 'Dokument w przygotowaniu - zostanie opublikowany przed uruchomieniem sprzedaży.',
  questionsBefore: 'W razie pytań ',
  questionsLink: 'napisz do mnie',
} as const;

export const notFound = {
  metaTitle: 'Nie znaleziono strony',
  overline: 'Błąd 404',
  title: 'Ups, tej strony',
  titleEm: 'nie ma',
  lead: 'Mogła zostać przeniesiona albo adres zawiera literówkę.',
  home: 'Strona główna',
} as const;

export const shop = {
  metaTitle: 'Sklep - ręcznie robione świece sojowe i z wosku pszczelego',
  metaDescription:
    'Świece-rzeźby by N.: róże, muszle, krówki Highland i inne formy z wosku sojowego i pszczelego. Ręcznie odlewane, gotowe na prezent.',
  title: 'Kolekcja świec',
  lead: 'Ręcznie odlewane świece z wosku sojowego i pszczelego - każda powstaje w małej partii, więc każdy egzemplarz jest trochę inny.',
  categories: 'Kategorie',
  all: 'Wszystkie',
  categoryFallbackDescription: '{name} - ręcznie robione świece by N.',
  emptyLead: 'Pierwsze świece trafią do sklepu już wkrótce.',
  emptyText: 'Do tego czasu możesz zamówić je przez wiadomość na Instagramie - odpiszę i pomogę wybrać.',
} as const;

export const product = {
  gallery: 'Zdjęcia produktu',
  galleryPrev: 'Poprzednie zdjęcie',
  galleryNext: 'Następne zdjęcie',
  gallerySlide: 'Zdjęcie {n} z {total}',
  omnibus: 'Najniższa cena z 30 dni przed obniżką: {price}',
  dimensions: 'Wymiary',
  addToCart: 'Dodaj do koszyka',
  lowStock: 'Zostało {n} szt. - każda świeca to ręcznie odlany egzemplarz.',
  shippingLocker: 'Paczkomat InPost',
  shippingFreeFrom: 'darmowa dostawa od {price}',
  returnDays: '14 dni na zwrot',
  specs: {
    wymiary: 'Wymiary',
    wosk: 'Wosk',
    knot: 'Knot',
    gramatura: 'Gramatura',
    czasPalenia: 'Czas palenia',
    pojemnik: 'Pojemnik',
    nutyGlowy: 'Nuty głowy',
    nutySerca: 'Nuty serca',
    nutyBazy: 'Nuty bazy',
  },
  grams: '{n} g',
  burnHours: 'ok. {n} h',
  careTitle: 'Pielęgnacja i palenie',
  care: [
    'Przed każdym zapaleniem przytnij knot do ok. 5 mm. Pal świecę na stabilnej, niepalnej podstawce, z dala od przeciągów.',
    'Świece-rzeźby zmieniają kształt podczas palenia - jeśli chcesz zachować formę, traktuj je jako dekorację.',
  ],
  safetyTitle: 'Bezpieczeństwo i producent',
  safety: 'Nigdy nie pozostawiaj palącej się świecy bez nadzoru. Przechowuj poza zasięgiem dzieci i zwierząt.',
  producer: 'Producent: {name}',
  deliveryTitle: 'Dostawa i zwroty',
  delivery: 'Wysyłka do Paczkomatu InPost{price}.',
  deliveryFree: ' Darmowa dostawa od {price}.',
  withdrawal: ' Masz 14 dni na odstąpienie od umowy. ',
  deliveryLink: 'Szczegóły dostawy i zwrotów',
} as const;

/** Teksty używane przez skrypty koszyka w przeglądarce - trzymaj ten eksport mały. */
export const cart = {
  title: 'Koszyk',
  open: 'Koszyk',
  openWithCount: 'Koszyk, {n} {products}',
  products: ['produkt', 'produkty', 'produktów'],
  close: 'Zamknij koszyk',
  promoBar: 'Promocja 2+1 - przy trzech świecach najtańsza gratis',
  emptyLead: 'Twój koszyk jest pusty.',
  emptyText: 'Zajrzyj do kolekcji - każda świeca to ręcznie odlany egzemplarz.',
  perUnit: '{price} / szt.',
  qtyGroup: 'Ilość: {name}',
  decrease: 'Zmniejsz ilość',
  increase: 'Zwiększ ilość',
  remove: 'Usuń',
  limit: 'To już wszystkie dostępne sztuki.',
  free: 'gratis',
  subtotal: 'Produkty',
  discount: 'Promocja 2+1',
  shipping: 'Dostawa (Paczkomat InPost)',
  total: 'Razem',
  checkout: 'Przejdź do zamówienia',
  continue: 'Kontynuuj zakupy',
  freeMissing: 'Brakuje {price} do darmowej dostawy',
  freeReached: 'Masz darmową dostawę',
  added: 'Dodano do koszyka ✓',
  addedLive: 'Dodano {name} do koszyka.',
  maxReached: 'Masz już wszystkie dostępne sztuki',
  maxReachedLive: 'Nie można dodać więcej: {name}.',
  removedLive: 'Usunięto {name} z koszyka.',
  updated: 'Ceny lub dostępność w koszyku zostały zaktualizowane.',
} as const;

export const checkout = {
  metaTitle: 'Zamówienie',
  title: 'Zamówienie',
  stepContact: 'Dane kontaktowe',
  stepDelivery: 'Dostawa - Paczkomat InPost',
  stepNotes: 'Uwagi',
  name: 'Imię i nazwisko',
  nameError: 'Podaj imię i nazwisko - będą na etykiecie paczki.',
  email: 'E-mail',
  emailHint: 'Wyślę na niego potwierdzenie zamówienia.',
  emailError: 'Wpisz adres e-mail w formacie nazwa@domena.pl.',
  phone: 'Telefon',
  phoneHint: 'InPost wyśle SMS z kodem odbioru.',
  phoneError: 'Wpisz 9-cyfrowy numer telefonu (może być z +48).',
  mapOpen: 'Wybierz paczkomat na mapie',
  mapClose: 'Zamknij mapę',
  mapLabel: 'Wybór paczkomatu',
  locker: 'Kod paczkomatu',
  lockerPlaceholder: 'np. KRA01M',
  lockerHintMap: 'Wybierz na mapie albo wpisz kod ręcznie.',
  lockerHintBefore: 'Kod znajdziesz na ',
  lockerHintLink: 'mapie paczkomatów InPost',
  lockerError: 'Podaj kod paczkomatu, np. KRA01M.',
  lockerSelected: 'Wybrano: {name}',
  gift: 'Zapakuj na prezent',
  giftHint: '(różowe pudełko lub celofan ze sznurkiem)',
  notes: 'Uwagi do zamówienia',
  optional: '(opcjonalnie)',
  termsBefore: 'Akceptuję ',
  termsLink: 'regulamin',
  termsMiddle: ' sklepu. Informacje o przetwarzaniu danych znajdziesz w ',
  privacyLink: 'polityce prywatności',
  termsError: 'Zaakceptuj regulamin, aby złożyć zamówienie.',
  submitPay: 'Zamawiam z obowiązkiem zapłaty',
  submitPrepare: 'Przygotuj zamówienie',
  submitting: 'Przekierowuję do płatności…',
  payments: 'Płatność kartą, BLIK lub przelewem przez Przelewy24.',
  submitError: 'Nie udało się utworzyć zamówienia. Spróbuj ponownie za chwilę albo napisz do mnie na Instagramie.',
  summary: 'Podsumowanie',
  due: 'Do zapłaty',
  lockerShipping: 'Paczkomat InPost',
  editCart: 'Edytuj koszyk',
  fallbackTitle: 'Prawie gotowe!',
  fallbackLead:
    'Płatności online uruchomię już wkrótce. Do tego czasu wyślij mi podsumowanie w wiadomości na Instagramie - potwierdzę zamówienie i podam dane do przelewu.',
  copy: 'Skopiuj podsumowanie',
  copied: 'Skopiowano - wklej podsumowanie w wiadomości na Instagramie.',
  copyFailed: 'Nie udało się skopiować automatycznie - zaznacz tekst powyżej i skopiuj go ręcznie.',
  text: {
    header: 'Zamówienie by N. candles',
    line: '• {name} × {qty} - {price}',
    discount: 'Promocja 2+1: −{price}',
    shipping: 'Dostawa (Paczkomat {locker}): {price}',
    total: 'Razem: {price}',
    gift: 'Pakowanie na prezent: tak',
    notes: 'Uwagi: {notes}',
  },
} as const;

/** Teksty alternatywne zdjęć (dostępność + SEO grafiki). */
export const images = {
  roze: 'Trzy świece sojowe w kształcie róż - biała, pudrowo-różowa i szara - na białej tacy obok wazonu z kwiatami',
  muszle: 'Dwie białe świece sojowe w kształcie muszli przegrzebka',
  rozaWrzosowa: 'Wrzosowa świeca w kształcie róży na podstawce z agatu',
  krowki: 'Cztery świece w kształcie kudłatych krówek Highland w kolorach różu, bieli, brązu i szarości',
  pszczeli: 'Świece z naturalnego wosku pszczelego w kształcie Buddy i buldoga francuskiego na tle wachlarza',
  misie: 'Różowy i biały miś - świece sojowe na białej tacy',
  kurka: 'Pudrowo-różowa świeca w kształcie kurki na ceramicznym talerzyku',
  buldog: 'Biała świeca w kształcie buldoga francuskiego',
  wSzkle: 'Świeca sojowa w szklanym naczyniu z pokrywką, udekorowana plastrem pomarańczy i laską cynamonu',
  procesKnot: 'Dłonie mocujące knot na dnie ryflowanej formy',
  procesZapach: 'Olejek zapachowy odmierzany kroplami do miarki',
  procesOdlewanie: 'Roztopiony wosk wlewany do formy z knotem przytrzymanym drewnianym patyczkiem',
  prezentZielona: 'Sojowa świeca w zielonym, żłobionym szklanym pojemniku z uchyloną pokrywką, udekorowana suszoną pomarańczą, cynamonem i goździkami',
  prezentAlpaka: 'Świeca-alpaka zapakowana w przezroczysty celofan ze sznurkiem, trzymana w dłoni',
  moai: 'Szaro-beżowa świeca w kształcie głowy Moai obok białego kwiatu',
  czaszka: 'Różowa świeca w kształcie czaszki na żółtej półce z książkami',
  krowaMech: 'Różowa świeca w kształcie kudłatej krowy Highland w zielonym mchu, w tle drewniany płot',
  dawid: 'Biała świeca w kształcie popiersia Dawida obok ryflowanego dyfuzora zapachowego',
  alpaki: 'Trzy świece-alpaki w kolorach szarym, ceglastym i beżowym na tle drewnianego płotu',
  lawenda: 'Dwie świece sojowe z lawendą w ryflowanych osłonkach, czarnej i białej, przed książką',
  cytryna: 'Żółta świeca w kształcie cytryny na ręcznie malowanej ceramicznej tacce, obok miska z cytrynami',
  buddy: 'Dwie świece w kształcie małego Buddy, niebieska i kremowa, w tle figurka słonia',
} as const;
