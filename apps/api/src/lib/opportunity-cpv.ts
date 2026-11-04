/**
 * English words for the CPV categories a technical supplier's catalogue speaks to. Notice titles arrive in the buyer's language
 * ("Dostawa punktów alarmowych", "Videoüberwachung"), but CPV codes do not, so these words let English catalogue terms find them.
 * Longest prefix wins. Internal ranking signal only, never shown.
 */
const CPV_WORDS: [prefix: string, words: string][] = [
  ['35121', 'security equipment alarm'], ['35125', 'surveillance system monitoring'], ['3512', 'security surveillance alarm systems devices'],
  ['31625', 'alarm intrusion burglar fire sensors'], ['3232350', 'video surveillance cctv camera recorder'], ['32323', 'video monitor camera'],
  ['45312', 'alarm installation intrusion fire'], ['50610', 'security equipment maintenance repair'], ['50413', 'alarm maintenance testing'],
  ['42961', 'access control command system'], ['4296', 'control automation plc'], ['31154', 'ups battery backup power'],
  ['3241', 'network gateway router communication'], ['3242', 'network equipment router switch'], ['32412', 'communications network'],
  ['3171', 'electronic equipment electronics'], ['31711', 'electronic components embedded'], ['3121', 'panel switchgear control'],
  ['3168', 'electrical supplies'], ['3842', 'sensors measuring monitoring'], ['3843', 'monitoring analysers'], ['3855', 'meters metering'],
  ['48', 'software'], ['72', 'software development consulting'], ['32', 'communication radio telecom'],
];

/** English category words for a notice's CPV codes. */
export function cpvWords(codes: string[]): string {
  const out = new Set<string>();
  for (const c of codes) {
    const hit = CPV_WORDS.filter(([p]) => c.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0];
    if (hit) for (const w of hit[1].split(' ')) out.add(w);
  }
  return [...out].join(' ');
}
