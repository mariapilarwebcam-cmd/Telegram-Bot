"use client"

import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/UserContext'

export default function PrivacyPage() {
  const router = useRouter()
  const { lang } = useUser()
  const isES = lang === 'es'

  return (
    <div className="page" style={{ paddingBottom: 32 }}>
      <header className="page-header">
        <button
          onClick={() => router.back()}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label={isES ? 'Volver' : 'Back'}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="m15 18-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h1 className="page-title" style={{ flex: 1, textAlign: 'center' }}>
          {isES ? 'Política de Privacidad' : 'Privacy Policy'}
        </h1>
        <div style={{ width: 22 }} />
      </header>

      <div style={{ padding: '20px 20px 0', maxWidth: 640, margin: '0 auto' }}>
        <p style={{ fontSize: 12, color: '#8b8b9e', margin: '0 0 24px 0' }}>
          {isES ? 'Última actualización:' : 'Last updated:'}{' '}
          {new Date().toLocaleDateString(isES ? 'es-ES' : 'en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>

        {isES ? <PrivacyES /> : <PrivacyEN />}

        {/* ─── Botón de eliminación de datos ─── */}
        <div
          style={{
            marginTop: 32,
            padding: 20,
            borderRadius: 16,
            background:
              'linear-gradient(135deg, rgba(236, 72, 153, 0.08) 0%, rgba(168, 85, 247, 0.06) 100%)',
            border: '1px solid rgba(236, 72, 153, 0.25)',
          }}
        >
          <h3
            style={{
              fontSize: 15,
              fontWeight: 800,
              color: '#f0abfc',
              margin: '0 0 8px 0',
            }}
          >
            {isES ? '🗑️ Eliminar mis datos' : '🗑️ Delete my data'}
          </h3>
          <p
            style={{
              fontSize: 13,
              color: '#c4b5fd',
              margin: '0 0 14px 0',
              lineHeight: 1.55,
            }}
          >
            {isES
              ? 'Puedes solicitar la eliminación completa de tu cuenta y datos asociados. La solicitud se procesará en un plazo máximo de 30 días.'
              : 'You can request complete deletion of your account and associated data. The request will be processed within a maximum of 30 days.'}
          </p>
          <a
            href="https://t.me/TabooRealmSupport"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(236, 72, 153, 0.4)',
            }}
          >
            {isES ? 'Contactar soporte' : 'Contact support'}
          </a>
        </div>

        {/* ─── Link a Terms ─── */}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
          }}
        >
          <button
            onClick={() => router.push('/legal/terms')}
            style={{
              background: 'rgba(168, 85, 247, 0.1)',
              border: '1px solid rgba(168, 85, 247, 0.25)',
              color: '#c4b5fd',
              padding: '10px 16px',
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {isES ? 'Términos de Servicio' : 'Terms of Service'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ESPAÑOL
// ═══════════════════════════════════════════════════════════════
function PrivacyES() {
  return (
    <>
      <Section title="1. Introducción">
        <p>
          En <strong>Taboo Realm</strong> ("nosotros", "el Servicio"),
          respetamos tu privacidad. Esta Política describe qué datos
          recopilamos, cómo los usamos y qué derechos tienes sobre ellos.
        </p>
        <p>
          Al usar el Servicio aceptas las prácticas descritas aquí, en
          conjunto con nuestros Términos de Servicio.
        </p>
      </Section>

      <Section title="2. Datos que recopilamos">
        <p>
          <strong>Datos de Telegram:</strong> cuando interactúas con
          nuestro bot o Mini App, recibimos de Telegram:
        </p>
        <ul>
          <li>ID de Telegram (identificador único numérico)</li>
          <li>Nombre (first_name) y opcionalmente username</li>
          <li>Idioma preferido de Telegram</li>
        </ul>
        <p>
          <strong>Datos de uso:</strong> almacenamos en nuestra base de
          datos:
        </p>
        <ul>
          <li>Género e interés declarados en el onboarding</li>
          <li>Personajes creados y conversaciones con ellos</li>
          <li>Saldo de gemas y transacciones</li>
          <li>Historial de compras (Stars y cripto)</li>
          <li>Sistema de referidos (códigos, referidos verificados)</li>
          <li>Datos de racha diaria y recompensas</li>
          <li>Fecha de verificación de edad</li>
        </ul>
        <p>
          <strong>Datos técnicos:</strong> registramos automáticamente
          direcciones IP y user-agents con fines de seguridad y
          limitación de tasa (rate limiting), con retención máxima de 24
          horas.
        </p>
      </Section>

      <Section title="3. Datos que NO recopilamos">
        <p>No solicitamos ni almacenamos:</p>
        <ul>
          <li>Nombre real, dirección, teléfono o documentos de identidad</li>
          <li>Datos biométricos</li>
          <li>Contactos de tu teléfono</li>
          <li>Ubicación GPS</li>
          <li>Acceso a cámara o micrófono sin tu consentimiento explícito</li>
          <li>Datos de salud, religiosos o políticos</li>
        </ul>
      </Section>

      <Section title="4. Cómo usamos tus datos">
        <p>Utilizamos tu información exclusivamente para:</p>
        <ul>
          <li>
            <strong>Operar el Servicio:</strong> generar respuestas de
            IA personalizadas, mostrar tu saldo, gestionar tus chats.
          </li>
          <li>
            <strong>Personalización:</strong> adaptar los personajes al
            género y preferencias que declaraste.
          </li>
          <li>
            <strong>Pagos:</strong> procesar compras de gemas y
            suscripciones a través de Telegram Stars y proveedores
            cripto autorizados.
          </li>
          <li>
            <strong>Prevención de abuso:</strong> detectar uso indebido,
            spam o violaciones de los Términos.
          </li>
          <li>
            <strong>Comunicación:</strong> enviarte notificaciones sobre
            tu cuenta, actualizaciones y mensajes de los personajes (si
            has interactuado con ellos recientemente).
          </li>
        </ul>
        <p>
          <strong>No vendemos ni compartimos tus datos con terceros</strong>{' '}
          con fines publicitarios.
        </p>
      </Section>

      <Section title="5. Terceros con los que compartimos datos">
        <p>
          Para operar el Servicio, transferimos datos limitados a estos
          proveedores:
        </p>
        <ul>
          <li>
            <strong>OpenRouter / DeepSeek:</strong> reciben los mensajes
            de chat anonimizados para generar respuestas de IA.
          </li>
          <li>
            <strong>DeepInfra / Wiro:</strong> reciben prompts de texto
            e imágenes de referencia para generar imágenes (nunca tu
            identidad).
          </li>
          <li>
            <strong>Telegram:</strong> procesa pagos con Stars y entrega
            los mensajes del bot.
          </li>
          <li>
            <strong>Cloudflare R2:</strong> aloja imágenes de personajes
            (no contiene datos personales tuyos).
          </li>
          <li>
            <strong>Turso (libSQL):</strong> base de datos donde reside
            tu información.
          </li>
          <li>
            <strong>Upstash Redis:</strong> cache de rate limiting
            (temporal, máx 24h).
          </li>
          <li>
            <strong>Sentry:</strong> captura errores técnicos
            (anonimizados).
          </li>
        </ul>
      </Section>

      <Section title="6. Retención de datos">
        <p>
          Conservamos tus datos mientras tu cuenta esté activa. Si
          solicitas la eliminación:
        </p>
        <ul>
          <li>Datos personales → eliminados en máx 30 días</li>
          <li>
            Registros de compras → conservados 5 años por obligación
            fiscal
          </li>
          <li>
            Historial de conversaciones → eliminado al eliminar tu cuenta
          </li>
        </ul>
      </Section>

      <Section title="7. Tus derechos">
        <p>Tienes derecho a:</p>
        <ul>
          <li>
            <strong>Acceso:</strong> solicitar una copia de tus datos.
          </li>
          <li>
            <strong>Rectificación:</strong> corregir información
            incorrecta (puedes hacerlo directamente en Ajustes).
          </li>
          <li>
            <strong>Eliminación:</strong> solicitar el borrado de tu
            cuenta y datos (ver sección inferior).
          </li>
          <li>
            <strong>Portabilidad:</strong> recibir tus datos en formato
            legible.
          </li>
          <li>
            <strong>Oposición:</strong> rechazar ciertos tratamientos
            (ej. mensajes proactivos).
          </li>
        </ul>
        <p>
          Ejerce estos derechos contactando a{' '}
          <strong>@TabooRealmSupport</strong>.
        </p>
      </Section>

      <Section title="8. Seguridad">
        <p>
          Implementamos medidas técnicas y organizativas para proteger
          tus datos:
        </p>
        <ul>
          <li>Cifrado TLS en todas las comunicaciones</li>
          <li>Validación criptográfica de Telegram initData</li>
          <li>Rate limiting por IP y por usuario</li>
          <li>Contraseñas y tokens nunca almacenados en texto plano</li>
        </ul>
        <p>
          Ningún sistema es 100% infalible. Si detectas una brecha,
          repórtala de inmediato a <strong>@TabooRealmSupport</strong>.
        </p>
      </Section>

      <Section title="9. Menores de edad">
        <p>
          El Servicio está estrictamente prohibido para menores de 18
          años. No recopilamos conscientemente datos de menores. Si
          detectamos una cuenta de menor, la eliminaremos de inmediato.
        </p>
      </Section>

      <Section title="10. Cookies y almacenamiento local">
        <p>
          La Mini App utiliza <strong>sessionStorage</strong> y{' '}
          <strong>localStorage</strong> para:
        </p>
        <ul>
          <li>Mantener tu sesión activa durante el uso</li>
          <li>Evitar procesar el mismo referido múltiples veces</li>
          <li>Cachear preferencias de UI</li>
        </ul>
        <p>
          No usamos cookies de rastreo publicitario. No compartimos
          información con redes publicitarias.
        </p>
      </Section>

      <Section title="11. Transferencias internacionales">
        <p>
          Nuestros servidores están distribuidos globalmente (Vercel,
          Cloudflare, Turso). Al usar el Servicio, tus datos pueden
          procesarse en jurisdicciones distintas a la tuya. Aplicamos
          las mismas medidas de seguridad independientemente de la
          ubicación.
        </p>
      </Section>

      <Section title="12. Cambios en la Política">
        <p>
          Podemos actualizar esta Política. Los cambios relevantes se
          notificarán a través del bot. El uso continuado implica
          aceptación.
        </p>
      </Section>

      <Section title="13. Contacto">
        <p>
          Para ejercer tus derechos o resolver dudas sobre privacidad:{' '}
          <strong>@TabooRealmSupport</strong> en Telegram.
        </p>
      </Section>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// ENGLISH
// ═══════════════════════════════════════════════════════════════
function PrivacyEN() {
  return (
    <>
      <Section title="1. Introduction">
        <p>
          At <strong>Taboo Realm</strong> ("we", "the Service"), we
          respect your privacy. This Policy describes what data we
          collect, how we use it, and what rights you have over it.
        </p>
        <p>
          By using the Service, you accept the practices described here,
          together with our Terms of Service.
        </p>
      </Section>

      <Section title="2. Data We Collect">
        <p>
          <strong>Telegram data:</strong> when you interact with our bot
          or Mini App, we receive from Telegram:
        </p>
        <ul>
          <li>Telegram ID (numeric unique identifier)</li>
          <li>First name and optionally username</li>
          <li>Preferred Telegram language</li>
        </ul>
        <p>
          <strong>Usage data:</strong> we store in our database:
        </p>
        <ul>
          <li>Gender and interest declared during onboarding</li>
          <li>Created characters and conversations with them</li>
          <li>Gem balance and transactions</li>
          <li>Purchase history (Stars and crypto)</li>
          <li>Referral system (codes, verified referrals)</li>
          <li>Daily streak and rewards data</li>
          <li>Age verification date</li>
        </ul>
        <p>
          <strong>Technical data:</strong> we automatically log IP
          addresses and user-agents for security and rate limiting
          purposes, with a maximum retention of 24 hours.
        </p>
      </Section>

      <Section title="3. Data We Do NOT Collect">
        <p>We do not request or store:</p>
        <ul>
          <li>Real name, address, phone or ID documents</li>
          <li>Biometric data</li>
          <li>Phone contacts</li>
          <li>GPS location</li>
          <li>Camera or microphone access without explicit consent</li>
          <li>Health, religious or political data</li>
        </ul>
      </Section>

      <Section title="4. How We Use Your Data">
        <p>We use your information exclusively to:</p>
        <ul>
          <li>
            <strong>Operate the Service:</strong> generate personalized
            AI responses, show your balance, manage your chats.
          </li>
          <li>
            <strong>Personalization:</strong> adapt characters to the
            gender and preferences you declared.
          </li>
          <li>
            <strong>Payments:</strong> process gem and subscription
            purchases via Telegram Stars and authorized crypto providers.
          </li>
          <li>
            <strong>Abuse prevention:</strong> detect misuse, spam or
            violations of the Terms.
          </li>
          <li>
            <strong>Communication:</strong> send you account
            notifications, updates, and messages from characters (if you
            recently interacted with them).
          </li>
        </ul>
        <p>
          <strong>We do not sell or share your data with third parties</strong>{' '}
          for advertising purposes.
        </p>
      </Section>

      <Section title="5. Third Parties We Share Data With">
        <p>
          To operate the Service, we transfer limited data to these
          providers:
        </p>
        <ul>
          <li>
            <strong>OpenRouter / DeepSeek:</strong> receive anonymized
            chat messages to generate AI responses.
          </li>
          <li>
            <strong>DeepInfra / Wiro:</strong> receive text prompts and
            reference images to generate images (never your identity).
          </li>
          <li>
            <strong>Telegram:</strong> processes Stars payments and
            delivers bot messages.
          </li>
          <li>
            <strong>Cloudflare R2:</strong> hosts character images (does
            not contain your personal data).
          </li>
          <li>
            <strong>Turso (libSQL):</strong> database where your
            information resides.
          </li>
          <li>
            <strong>Upstash Redis:</strong> rate limiting cache
            (temporary, max 24h).
          </li>
          <li>
            <strong>Sentry:</strong> captures technical errors
            (anonymized).
          </li>
        </ul>
      </Section>

      <Section title="6. Data Retention">
        <p>
          We retain your data while your account is active. If you
          request deletion:
        </p>
        <ul>
          <li>Personal data → deleted within max 30 days</li>
          <li>
            Purchase records → retained 5 years per tax obligation
          </li>
          <li>Conversation history → deleted upon account deletion</li>
        </ul>
      </Section>

      <Section title="7. Your Rights">
        <p>You have the right to:</p>
        <ul>
          <li>
            <strong>Access:</strong> request a copy of your data.
          </li>
          <li>
            <strong>Rectification:</strong> correct incorrect
            information (you can do so directly in Settings).
          </li>
          <li>
            <strong>Erasure:</strong> request deletion of your account
            and data (see section below).
          </li>
          <li>
            <strong>Portability:</strong> receive your data in
            machine-readable format.
          </li>
          <li>
            <strong>Objection:</strong> opt out of certain processing
            (e.g., proactive messages).
          </li>
        </ul>
        <p>
          Exercise these rights by contacting{' '}
          <strong>@TabooRealmSupport</strong>.
        </p>
      </Section>

      <Section title="8. Security">
        <p>
          We implement technical and organizational measures to protect
          your data:
        </p>
        <ul>
          <li>TLS encryption on all communications</li>
          <li>Cryptographic validation of Telegram initData</li>
          <li>Rate limiting per IP and per user</li>
          <li>Passwords and tokens never stored in plaintext</li>
        </ul>
        <p>
          No system is 100% infallible. If you detect a breach, report
          it immediately at <strong>@TabooRealmSupport</strong>.
        </p>
      </Section>

      <Section title="9. Minors">
        <p>
          The Service is strictly prohibited for users under 18. We do
          not knowingly collect data from minors. If we detect a minor's
          account, we will delete it immediately.
        </p>
      </Section>

      <Section title="10. Cookies and Local Storage">
        <p>The Mini App uses <strong>sessionStorage</strong> and <strong>localStorage</strong> to:</p>
        <ul>
          <li>Keep your session active during use</li>
          <li>Avoid processing the same referral multiple times</li>
          <li>Cache UI preferences</li>
        </ul>
        <p>
          We do not use advertising tracking cookies. We do not share
          information with ad networks.
        </p>
      </Section>

      <Section title="11. International Transfers">
        <p>
          Our servers are globally distributed (Vercel, Cloudflare,
          Turso). By using the Service, your data may be processed in
          jurisdictions other than yours. We apply the same security
          measures regardless of location.
        </p>
      </Section>

      <Section title="12. Policy Changes">
        <p>
          We may update this Policy. Material changes will be notified
          through the bot. Continued use implies acceptance.
        </p>
      </Section>

      <Section title="13. Contact">
        <p>
          To exercise your rights or resolve privacy questions:{' '}
          <strong>@TabooRealmSupport</strong> on Telegram.
        </p>
      </Section>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// Helper component
// ═══════════════════════════════════════════════════════════════
function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: '#f0abfc',
          margin: '0 0 10px 0',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontSize: 14,
          color: '#c4b5fd',
          lineHeight: 1.7,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {children}
      </div>
      <style jsx>{`
        section :global(p) {
          margin: 0;
        }
        section :global(ul) {
          margin: 0;
          padding-left: 20px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        section :global(li) {
          font-size: 14px;
        }
        section :global(strong) {
          color: #f5f0ff;
          font-weight: 700;
        }
      `}</style>
    </section>
  )
}