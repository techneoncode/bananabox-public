export const termsUrl = (lang: string): string =>
  `https://github.com/techneoncode/bananabox-public/blob/main/docs/terms${lang === 'fr' ? '.fr' : ''}.md`;
