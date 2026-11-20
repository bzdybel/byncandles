import { collection, config, fields, singleton } from '@keystatic/core';

/**
 * Panel treści dla Natalii - /keystatic
 * Lokalnie: storage 'local' (zapis do plików). Produkcja (logowanie GitHub) - osobny etap.
 */
export default config({
  storage: { kind: 'local' },
  locale: 'pl-PL',
  ui: {
    brand: { name: 'by N. candles' },
    navigation: {
      Sklep: ['produkty', 'kategorie'],
      Ustawienia: ['ustawienia'],
    },
  },

  collections: {
    produkty: collection({
      label: 'Produkty',
      slugField: 'nazwa',
      path: 'src/content/produkty/*',
      format: { data: 'yaml' },
      columns: ['nazwa', 'kategoria', 'status'],
      schema: {
        nazwa: fields.slug({
          name: { label: 'Nazwa produktu', validation: { isRequired: true, length: { max: 80 } } },
          slug: { label: 'Adres URL', description: 'Np. swieca-sojowa-wanilia - pojawi się w /sklep/…' },
        }),
        status: fields.select({
          label: 'Status',
          options: [
            { label: 'Dostępny', value: 'dostepny' },
            { label: 'Wkrótce', value: 'wkrotce' },
            { label: 'Wyprzedany', value: 'wyprzedany' },
            { label: 'Ukryty (niewidoczny na stronie)', value: 'ukryty' },
          ],
          defaultValue: 'ukryty',
        }),
        wyrozniony: fields.checkbox({ label: 'Pokaż na stronie głównej', defaultValue: false }),
        kategoria: fields.relationship({ label: 'Kategoria', collection: 'kategorie' }),
        cena: fields.number({
          label: 'Cena (zł)',
          description: 'Zostaw puste, żeby użyć ceny domyślnej z Ustawień sklepu.',
          step: 0.01,
          validation: { min: 0 },
        }),
        cenaPromocyjna: fields.number({
          label: 'Cena promocyjna (zł)',
          description: 'Zostaw puste, jeśli brak promocji.',
          step: 0.01,
          validation: { min: 0 },
        }),
        najnizszaCena30dni: fields.number({
          label: 'Najniższa cena z 30 dni przed promocją (zł)',
          description: 'Wymagane przy promocji (dyrektywa Omnibus).',
          step: 0.01,
          validation: { min: 0 },
        }),
        stan: fields.integer({ label: 'Stan magazynowy (szt.)', defaultValue: 0, validation: { min: 0 } }),
        krotkiOpis: fields.text({
          label: 'Krótki opis',
          description: 'Do 160 znaków - wyświetlany w Google i na liście produktów.',
          validation: { isRequired: true, length: { max: 160 } },
        }),
        opis: fields.text({
          label: 'Pełny opis',
          description: 'Akapity oddzielaj pustą linią.',
          multiline: true,
        }),
        zdjecia: fields.array(
          fields.object({
            zdjecie: fields.image({
              label: 'Zdjęcie',
              directory: 'src/assets/produkty',
              publicPath: '../../assets/produkty/',
              validation: { isRequired: true },
            }),
            alt: fields.text({
              label: 'Opis zdjęcia (alt)',
              description: 'Co widać na zdjęciu - ważne dla Google i osób niewidomych.',
              validation: { isRequired: true },
            }),
          }),
          {
            label: 'Zdjęcia',
            description: 'Pierwsze zdjęcie jest główne.',
            itemLabel: (p) => p.fields.alt.value || 'Zdjęcie',
            validation: { length: { min: 1 } },
          },
        ),
        zapach: fields.object(
          {
            nutyGlowy: fields.text({ label: 'Nuty głowy' }),
            nutySerca: fields.text({ label: 'Nuty serca' }),
            nutyBazy: fields.text({ label: 'Nuty bazy' }),
          },
          { label: 'Kompozycja zapachowa' },
        ),
        szczegoly: fields.object(
          {
            wosk: fields.select({
              label: 'Wosk',
              options: [
                { label: 'Sojowy', value: 'sojowy' },
                { label: 'Pszczeli', value: 'pszczeli' },
                { label: 'Sojowy z pszczelim', value: 'sojowoPszczeli' },
                { label: 'Rzepakowy', value: 'rzepakowy' },
                { label: 'Kokosowy', value: 'kokosowy' },
                { label: 'Mieszanka', value: 'mieszanka' },
                { label: 'Inny', value: 'inny' },
              ],
              defaultValue: 'sojowy',
            }),
            wymiary: fields.text({
              label: 'Wymiary',
              description: 'Wysokość × szerokość × głębokość, np. 9 × 7 × 6 cm - kluczowe przy świecach-rzeźbach.',
            }),
            knot: fields.text({ label: 'Knot', description: 'Np. bawełniany, drewniany' }),
            gramatura: fields.integer({ label: 'Gramatura (g)', validation: { min: 0 } }),
            czasPalenia: fields.integer({ label: 'Czas palenia (h, orientacyjnie)', validation: { min: 0 } }),
            pojemnik: fields.text({ label: 'Pojemnik', description: 'Np. szkło bursztynowe z pokrywką' }),
          },
          { label: 'Szczegóły' },
        ),
        bezpieczenstwo: fields.text({
          label: 'Ostrzeżenia i informacje CLP',
          description: 'Zwroty H/P i alergeny z karty charakterystyki olejku zapachowego (wymóg prawny).',
          multiline: true,
        }),
        seo: fields.object(
          {
            tytul: fields.text({ label: 'Tytuł w Google (opcjonalnie)', validation: { length: { max: 60 } } }),
            opis: fields.text({ label: 'Opis w Google (opcjonalnie)', validation: { length: { max: 160 } } }),
          },
          { label: 'SEO' },
        ),
      },
    }),

    kategorie: collection({
      label: 'Kategorie',
      slugField: 'nazwa',
      path: 'src/content/kategorie/*',
      format: { data: 'yaml' },
      schema: {
        nazwa: fields.slug({ name: { label: 'Nazwa kategorii', validation: { isRequired: true } } }),
        opis: fields.text({
          label: 'Opis kategorii',
          description: 'Tekst nad listą produktów - ważny dla SEO (2-4 zdania).',
          multiline: true,
        }),
        kolejnosc: fields.integer({ label: 'Kolejność', defaultValue: 0 }),
      },
    }),
  },

  singletons: {
    ustawienia: singleton({
      label: 'Ustawienia sklepu',
      path: 'src/content/ustawienia',
      format: { data: 'yaml' },
      schema: {
        email: fields.text({ label: 'E-mail kontaktowy' }),
        cenaDomyslna: fields.number({
          label: 'Cena domyślna produktu (zł)',
          description: 'Obowiązuje dla każdego produktu bez własnej ceny - zmień tutaj, żeby zmienić cenę całego sklepu.',
          step: 0.01,
        }),
        wysylkaPaczkomat: fields.number({ label: 'Koszt wysyłki - Paczkomat InPost (zł)', step: 0.01, defaultValue: 0 }),
        wysylkaKurier: fields.number({ label: 'Koszt wysyłki - Kurier InPost (zł, puste = wyłączony)', step: 0.01 }),
        darmowaWysylkaOd: fields.number({ label: 'Darmowa wysyłka od (zł, puste = brak)', step: 0.01 }),
        promocja2plus1: fields.checkbox({
          label: 'Promocja 2+1',
          description: 'Przy 3 sztukach w koszyku najtańsza gratis (co trzecia sztuka).',
          defaultValue: false,
        }),
        producent: fields.object(
          {
            nazwa: fields.text({ label: 'Nazwa producenta / firmy' }),
            adres: fields.text({ label: 'Adres', multiline: true }),
            kontakt: fields.text({ label: 'E-mail lub telefon do kontaktu' }),
          },
          { label: 'Dane producenta (GPSR - wyświetlane przy produktach)' },
        ),
      },
    }),
  },
});
