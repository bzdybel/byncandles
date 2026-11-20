/** Dane strukturalne schema.org (JSON-LD) - budowane w jednym miejscu, strony tylko je osadzają. */
import { brand } from '../i18n/pl.ts';
import { toGrosze } from './money.ts';
import { cenaAktualna, dostepnoscSchema, urlProduktu, type Kategoria, type Produkt, type Ustawienia } from './shop.ts';
import { SITE_URL } from './site.ts';

const RETURN_DAYS = 14;
const money = (zl: number) => (toGrosze(zl) / 100).toFixed(2);

export function productJsonLd(produkt: Produkt, opts: { kategoria?: Kategoria; ustawienia: Ustawienia; images: string[] }) {
  const p = produkt.data;
  const url = new URL(urlProduktu(produkt), SITE_URL).href;
  return {
    '@type': 'Product',
    '@id': `${url}#product`,
    name: p.nazwa,
    description: p.krotkiOpis,
    image: opts.images,
    sku: produkt.id,
    brand: { '@type': 'Brand', name: brand.name },
    ...(opts.kategoria && { category: opts.kategoria.data.nazwa }),
    ...(p.szczegoly?.gramatura && { weight: { '@type': 'QuantitativeValue', value: p.szczegoly.gramatura, unitCode: 'GRM' } }),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'PLN',
      price: money(cenaAktualna(p)),
      availability: dostepnoscSchema(p),
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': `${SITE_URL}/#organization` },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: money(opts.ustawienia.wysylkaPaczkomat), currency: 'PLN' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'PL' },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'PL',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: RETURN_DAYS,
        returnMethod: 'https://schema.org/ReturnByMail',
      },
    },
  };
}
