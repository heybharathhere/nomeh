/* Short lines only — this file exists specifically so long explanatory
 * paragraphs elsewhere don't have to. If a line needs a comma to make its
 * point, it is too long for here. */
const QUOTES = [
  'Anything counts.',
  'Show up. That is the whole rule.',
  'Small and today beats perfect and someday.',
  'A walk counts. So does one set.',
  'Log it and move on.',
  'Consistency, not intensity.',
  'Today only needs one thing.',
  'Not zero. That is the bar.',
  'Do the boring thing.',
  'One entry keeps the chain.',
];

/* Date-seeded so the quote holds steady across re-renders within a day,
 * rather than changing every time this screen redraws. */
export function quoteOfTheDay(dateKey) {
  let seed = 0;
  for (let i = 0; i < dateKey.length; i++) seed = (seed * 31 + dateKey.charCodeAt(i)) >>> 0;
  return QUOTES[seed % QUOTES.length];
}
