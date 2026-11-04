// lib/gender.ts
// Reglas de concordancia de género para los prompts del chat.
// No infiere ni afirma orientación sexual ni tipo de relación: solo gramática.

export function buildGenderRules(
  userGender: string | null | undefined,
  charGender: string,
  lang: 'es' | 'en'
): string {
  const normalizedUser =
    userGender === 'male' || userGender === 'female' ? userGender : null
  const charIsMale = charGender === 'male'
  const unknown = normalizedUser === null

  if (lang === 'es') {
    const u =
      normalizedUser === 'male'
        ? 'hombre'
        : normalizedUser === 'female'
          ? 'mujer'
          : 'sin especificar'
    const c = charIsMale ? 'hombre' : 'mujer'

    return `REGLA DE GÉNERO (CRÍTICA):
- El USUARIO es ${u}. TÚ (el personaje) eres ${c}.
- Concordancia del PERSONAJE: todos los adjetivos, participios y profesiones que uses sobre ti deben concordar con TU género.
  · Si eres hombre → "cansado", "listo", "seguro de mí"
  · Si eres mujer → "cansada", "lista", "segura de mí"
- Concordancia hacia el USUARIO: adapta pronombres, adjetivos y términos cariñosos a su género.
  · A un hombre: "guapo", "apuesto", "muchacho" (NO "hermosa", "bonita", "chica")
  · A una mujer: "hermosa", "bonita", "chica" (NO "guapo", "apuesto", "muchacho")
- Posesivos referidos al personaje: "soy tuyo/tuya" y "hazme tuyo/tuya" se conjugan según TU género.
  · Personaje hombre → "soy tuyo", "hazme tuyo"
  · Personaje mujer → "soy tuya", "hazme tuya"
- Cuando el personaje posee algo, el posesivo concuerda con lo poseído: "lo que es mío, lo cuido" no cambia según el género del usuario.${unknown ? '\n- El usuario no especificó su género: usa un tono neutro, evita asumir y, si encaja, pregunta con sutileza.' : ''}`
  }

  const uEN =
    normalizedUser === 'male'
      ? 'a man'
      : normalizedUser === 'female'
        ? 'a woman'
        : 'unspecified'
  const cEN = charIsMale ? 'a man' : 'a woman'

  return `GENDER RULE (CRITICAL):
- The USER is ${uEN}. YOU (the character) are ${cEN}.
- CHARACTER agreement: every adjective and gendered noun you use about yourself must match YOUR gender ("actor" vs "actress"). Use I/me/my when speaking in first person. When referring to yourself in third person, use pronouns consistent with your character identity.
- USER agreement: adapt pronouns, adjectives and pet names to the user's gender ("handsome" vs "beautiful", "boy" vs "girl").
- Possessives about the character: "I'm yours" / "make me yours" follow YOUR identity, not the user's.
- When the character owns something, the possessive stays with the owned thing: "what is mine, I take care of" does not change with the user's gender.${unknown ? "\n- The user didn't specify their gender: use a neutral tone, avoid assuming and, if it fits, ask subtly." : ''}`
}
