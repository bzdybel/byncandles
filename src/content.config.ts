import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { load as parseYaml } from 'js-yaml';

/** Schemat odpowiada keystatic.config.ts — pola puste w panelu przychodzą jako null. */
const opt = <T extends z.ZodType>(s: T) => s.nullish().transform((v) => v ?? undefined);
const optText = opt(z.string()).transform((v) => (v?.trim() ? v.trim() : undefined));

const produkty = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/produkty' }),
  schema: ({ image }) =>
    z
      .object({
        nazwa: z.string(),
        status: z.enum(['dostepny', 'wkrotce', 'wyprzedany', 'ukryty']).default('ukryty'),
        wyrozniony: z.boolean().default(false),
        kategoria: opt(reference('kategorie')),
        cena: z.number().nonnegative(),
        cenaPromocyjna: opt(z.number().nonnegative()),
        najnizszaCena30dni: opt(z.number().nonnegative()),
        stan: z.number().int().nonnegative().nullish().transform((v) => v ?? 0),
        krotkiOpis: z.string().max(160),
        opis: optText,
        zdjecia: z.array(z.object({ zdjecie: image(), alt: z.string().min(1) })).min(1),
        zapach: opt(
          z.object({ nutyGlowy: optText, nutySerca: optText, nutyBazy: optText }),
        ),
        szczegoly: opt(
          z.object({
            wosk: opt(z.enum(['sojowy', 'rzepakowy', 'kokosowy', 'mieszanka', 'inny'])),
            wymiary: optText,
            knot: optText,
            gramatura: opt(z.number().int()),
            czasPalenia: opt(z.number().int()),
            pojemnik: optText,
          }),
        ),
        bezpieczenstwo: optText,
        seo: opt(z.object({ tytul: optText, opis: optText })),
      })
      .refine((p) => p.cenaPromocyjna === undefined || p.cenaPromocyjna < p.cena, {
        message: 'Cena promocyjna musi być niższa od ceny regularnej.',
        path: ['cenaPromocyjna'],
      })
      .refine((p) => p.cenaPromocyjna === undefined || p.najnizszaCena30dni !== undefined, {
        message: 'Przy promocji podaj najniższą cenę z 30 dni (Omnibus).',
        path: ['najnizszaCena30dni'],
      }),
});

const kategorie = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/kategorie' }),
  schema: z.object({
    nazwa: z.string(),
    opis: optText,
    kolejnosc: z.number().int().nullish().transform((v) => v ?? 0),
  }),
});

const ustawienia = defineCollection({
  // Singleton z panelu Keystatic — jeden wpis o id "sklep".
  loader: file('./src/content/ustawienia.yaml', {
    parser: (text) => ({ sklep: (parseYaml(text) as Record<string, unknown>) ?? {} }),
  }),
  schema: z.object({
    email: optText,
    wysylkaPaczkomat: z.number().nonnegative().nullish().transform((v) => v ?? 0),
    wysylkaKurier: opt(z.number().nonnegative()),
    darmowaWysylkaOd: opt(z.number().nonnegative()),
    producent: opt(z.object({ nazwa: optText, adres: optText, kontakt: optText })),
  }),
});

export const collections = { produkty, kategorie, ustawienia };
