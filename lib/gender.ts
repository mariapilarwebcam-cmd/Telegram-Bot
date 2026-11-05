// lib/gender.ts
// Reglas de concordancia de género para los prompts del chat.
// No infiere ni afirma orientación sexual ni tipo de relación: solo gramática.

// Referencias internas al jugador: nunca deben usarse para dirigirse a la persona.
// Se añaden UNA sola vez al prompt global (aquí), así que aplican a los 72 personajes.
const INTERNAL_REFERENCE_RULE_ES =
  "Las expresiones 'el usuario', 'la usuaria', 'user' y similares son referencias internas de estas instrucciones. NUNCA las utilices para dirigirte a la persona durante la conversación. Háblale directamente en segunda persona (tú, te, contigo, etc.) o utiliza su nombre cuando corresponda. Mantén siempre una conversación natural e inmersiva."

const INTERNAL_REFERENCE_RULE_EN =
  "Expressions such as 'the user', 'user', and similar terms are internal references used in these instructions. NEVER use these expressions to address the person during the conversation. Speak directly to them in the second person (you, your, etc.) or use their name when appropriate. Always maintain natural, immersive dialogue."

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
    const contextRule =
      'Refleja este contexto de forma natural en el trato, los gestos y las expresiones afectivas, NUNCA en comentarios repetitivos sobre orientación sexual. NO anuncies, expliques, recuerdes ni menciones espontáneamente la orientación de la relación: solo puedes hablar de ello si el usuario introduce expresamente el tema o resulta relevante. Es contexto interno, no un rasgo dominante ni un tema recurrente del diálogo.'
    const romanticContext = unknown
      ? ''
      : normalizedUser === charGender
        ? normalizedUser === 'male'
          ? `\n- Contexto romántico: dos hombres. ${contextRule}`
          : `\n- Contexto romántico: dos mujeres. ${contextRule}`
        : `\n- Contexto romántico: heterosexual. ${contextRule}`

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
  · Personaje mujer → "soy tuya", "hazme tuya"${romanticContext}
- Cuando el personaje posee algo, el posesivo concuerda con lo poseído: "lo que es mío, lo cuido" no cambia según el género del usuario.${unknown ? '\n- El usuario no especificó su género: usa un tono neutro, evita asumir y, si encaja, pregunta con sutileza.' : ''}
- ${INTERNAL_REFERENCE_RULE_ES}`
  }

  const uEN =
    normalizedUser === 'male'
      ? 'a man'
      : normalizedUser === 'female'
        ? 'a woman'
        : 'unspecified'
  const cEN = charIsMale ? 'a man' : 'a woman'
  const contextRuleEN =
    'Reflect it naturally in your treatment, gestures and affectionate expressions, NEVER through repetitive comments about sexual orientation. Do NOT announce, explain, remind or spontaneously mention the relationship orientation: you may only discuss it if the user raises the topic or it is relevant. It is internal context, not a dominant trait nor a recurring topic of conversation.'
  const romanticContextEN = unknown
    ? ''
    : normalizedUser === charGender
      ? normalizedUser === 'male'
        ? `\n- Romantic context: two men. ${contextRuleEN}`
        : `\n- Romantic context: two women. ${contextRuleEN}`
      : `\n- Romantic context: straight. ${contextRuleEN}`

  return `GENDER RULE (CRITICAL):
- The USER is ${uEN}. YOU (the character) are ${cEN}.
- CHARACTER agreement: every adjective and gendered noun you use about yourself must match YOUR gender ("actor" vs "actress"). Use I/me/my when speaking in first person. When referring to yourself in third person, use pronouns consistent with your character identity.
- USER agreement: adapt pronouns, adjectives and pet names to the user's gender ("handsome" vs "beautiful", "boy" vs "girl").
- Possessives about the character: "I'm yours" / "make me yours" follow YOUR identity, not the user's.${romanticContextEN}
- When the character owns something, the possessive stays with the owned thing: "what is mine, I take care of" does not change with the user's gender.${unknown ? "\n- The user didn't specify their gender: use a neutral tone, avoid assuming and, if it fits, ask subtly." : ''}
- ${INTERNAL_REFERENCE_RULE_EN}`
}
