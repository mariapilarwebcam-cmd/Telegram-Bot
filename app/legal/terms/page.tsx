"use client"

import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/UserContext'

export default function TermsPage() {
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
          {isES ? 'Términos de Servicio' : 'Terms of Service'}
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

        {isES ? <TermsES /> : <TermsEN />}

        <div
          style={{
            marginTop: 32,
            padding: 16,
            borderRadius: 14,
            background: 'rgba(168, 85, 247, 0.06)',
            border: '1px solid rgba(168, 85, 247, 0.15)',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 12, color: '#a395c9', margin: 0, lineHeight: 1.55 }}>
            {isES
              ? 'Al continuar usando Taboo Realm confirmas que has leído y aceptas estos Términos.'
              : 'By continuing to use Taboo Realm you confirm you have read and accept these Terms.'}
          </p>
        </div>

        <div
          style={{
            marginTop: 16,
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
          }}
        >
          <button
            onClick={() => router.push('/legal/privacy')}
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
            {isES ? 'Política de Privacidad' : 'Privacy Policy'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ESPAÑOL
// ═══════════════════════════════════════════════════════════════
function TermsES() {
  return (
    <>
      <Section title="1. Aceptación de los Términos">
        <p>
          Al acceder o usar <strong>Taboo Realm</strong> (el "Servicio"),
          operado a través del bot de Telegram y la Mini App asociada,
          aceptas estos Términos de Servicio. Si no estás de acuerdo,
          debes abstenerte de usar el Servicio.
        </p>
      </Section>

      <Section title="2. Requisito de edad">
        <p>
          El Servicio contiene <strong>contenido para adultos</strong> y está
          estrictamente reservado para usuarios de <strong>18 años o más</strong>{' '}
          (o la mayoría de edad legal en tu jurisdicción, la que sea mayor).
        </p>
        <p>
          Al usar el Servicio declaras y garantizas que cumples este
          requisito. Nos reservamos el derecho de bloquear el acceso a
          cualquier usuario que no pueda verificar su edad.
        </p>
      </Section>

      <Section title="3. Naturaleza del contenido">
        <p>
          Todos los personajes, conversaciones e imágenes son{' '}
          <strong>obras de ficción generadas por inteligencia artificial</strong>.
        </p>
        <ul>
          <li>
            No representan a personas reales, vivas o fallecidas, salvo
            que se indique explícitamente lo contrario.
          </li>
          <li>
            No son consejos profesionales de ningún tipo (médicos,
            legales, psicológicos o financieros).
          </li>
          <li>
            Las respuestas de la IA pueden contener imprecisiones o
            comportamientos inesperados.
          </li>
        </ul>
      </Section>

      <Section title="4. Uso aceptable">
        <p>Te comprometes a NO usar el Servicio para:</p>
        <ul>
          <li>Actividades ilegales o que infrinjan derechos de terceros.</li>
          <li>
            Generar contenido que involucre a menores de edad, violencia
            real no consentida, o actos ilegales.
          </li>
          <li>
            Acosar, amenazar o suplantar a otras personas.
          </li>
          <li>
            Intentar extraer, copiar o reproducir a gran escala el
            contenido del Servicio.
          </li>
          <li>
            Realizar ingeniería inversa, scraping automatizado o abuso
            de la infraestructura.
          </li>
        </ul>
      </Section>

      <Section title="5. Personajes y contenido de terceros">
        <p>
          Los personajes son arquetipos ficticios. No imitamos ni
          representamos personajes con derechos de autor, celebridades
          reales o marcas registradas.
        </p>
        <p>
          Si crees que algún contenido infringe tus derechos, contáctanos
          en <strong>@TabooRealmSupport</strong> con la documentación
          correspondiente y actuaremos en un plazo razonable.
        </p>
      </Section>

      <Section title="6. Compras y gemas virtuales">
        <p>
          El Servicio ofrece <strong>gemas virtuales</strong> y{' '}
          <strong>suscripciones</strong> adquiribles mediante Telegram
          Stars, criptomonedas u otros métodos soportados.
        </p>
        <ul>
          <li>
            Las gemas son un bien virtual sin valor monetario fuera del
            Servicio. No son reembolsables salvo obligación legal.
          </li>
          <li>
            Las suscripciones se renuevan automáticamente salvo que las
            canceles antes del siguiente ciclo.
          </li>
          <li>
            Podemos modificar los precios con aviso previo razonable.
          </li>
        </ul>
      </Section>

      <Section title="7. Reembolsos">
        <p>
          Los reembolsos se procesan a través de Telegram (Stars) o el
          proveedor correspondiente (cripto). Dado que los bienes son
          digitales y de consumo inmediato, no ofrecemos reembolsos
          discrecionales salvo que la ley lo requiera.
        </p>
        <p>
          Si experimentas un problema técnico que impidió el uso del
          Servicio, contáctanos y evaluaremos cada caso.
        </p>
      </Section>

      <Section title="8. Cuenta y acceso">
        <p>
          Tu cuenta está vinculada a tu identidad de Telegram. Eres
          responsable de mantener la seguridad de tu cuenta.
        </p>
        <p>
          Podemos suspender o eliminar cuentas que violen estos Términos,
          sin previo aviso.
        </p>
      </Section>

      <Section title="9. Limitación de responsabilidad">
        <p>
          El Servicio se proporciona "tal cual". No garantizamos
          disponibilidad continua, exactitud del contenido generado por
          IA, ni ausencia de errores.
        </p>
        <p>
          En la máxima medida permitida por la ley, no somos responsables
          de daños indirectos, incidentales o consecuentes derivados del
          uso del Servicio.
        </p>
      </Section>

      <Section title="10. Cambios en los Términos">
        <p>
          Podemos actualizar estos Términos. Los cambios relevantes se
          notificarán a través del bot. El uso continuado después de los
          cambios implica aceptación.
        </p>
      </Section>

      <Section title="11. Ley aplicable">
        <p>
          Estos Términos se rigen por las leyes aplicables en la
          jurisdicción del operador. Cualquier disputa se resolverá en
          los tribunales competentes de dicha jurisdicción.
        </p>
      </Section>

      <Section title="12. Propiedad intelectual">
        <p>
          Todo el contenido del Servicio —incluyendo pero no limitado a
          personajes, arquetipos, textos, imágenes generadas, interfaz,
          código fuente, logotipos y elementos visuales— es propiedad
          de Taboo Realm o se utiliza bajo licencia.
        </p>
        <p>
          No está permitido copiar, reproducir, distribuir, modificar,
          vender, revender o explotar comercialmente cualquier parte
          del Servicio sin autorización previa por escrito.
        </p>
      </Section>

      <Section title="13. Uso Justo y Cupos VIP">
        <p>
          La suscripción VIP incluye los siguientes cupos mensuales,
          sujetos a las reglas de uso justo descritas a continuación:
        </p>
        <ul>
          <li>
            <strong>6.000 mensajes al mes</strong> (hasta 200/día,
            reset diario a las 00:00 UTC)
          </li>
          <li>
            <strong>30 imágenes IA premium al mes</strong> (hasta 1/día,
            acumulable hasta un máximo de 5 en reserva)
          </li>
          <li>
            <strong>Hasta 300 imágenes SFW al mes</strong> desde
            nuestra biblioteca compartida
          </li>
          <li>
            <strong>18 personajes exclusivos</strong> con contenido
            y arquetipos únicos
          </li>
        </ul>
        <p>
          <strong>Reglas de acumulación:</strong> los mensajes no se
          acumulan más allá del cupo diario. Las imágenes IA premium
          sí se acumulan hasta un máximo de <strong>5 en reserva</strong>;
          las que superen ese límite se pierden al sexto día sin uso.
        </p>
        <p>
          <strong>Uso justo:</strong> los cupos son personales e
          intransferibles. Está prohibido usar bots, scripts,
          automatizaciones o herramientas externas para eludir los
          límites, compartir credenciales, o hacer scraping y
          extracción masiva del contenido.
        </p>
        <p>
          <strong>Consecuencias del abuso:</strong> en caso de abuso
          comprobado, nos reservamos el derecho de suspender o
          cancelar la cuenta sin reembolso.
        </p>
        <p>
          <strong>Imágenes generadas por IA:</strong> son únicas y
          pueden variar según el contexto. No garantizamos una imagen
          específica, solo el acceso al sistema de generación dentro
          de los cupos indicados.
        </p>
        <p>
          <strong>Modificaciones:</strong> los cupos pueden ajustarse
          con 30 días de aviso previo a través del bot. El uso
          continuado tras la modificación implica aceptación.
        </p>
      </Section>

      <Section title="14. Contacto">
        <p>
          Para cualquier duda, soporte o reclamo:{' '}
          <strong>@TabooRealmSupport</strong> en Telegram.
        </p>
      </Section>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// ENGLISH
// ═══════════════════════════════════════════════════════════════
function TermsEN() {
  return (
    <>
      <Section title="1. Acceptance of Terms">
        <p>
          By accessing or using <strong>Taboo Realm</strong> (the
          "Service"), operated via a Telegram bot and its associated Mini
          App, you agree to these Terms of Service. If you do not agree,
          you must refrain from using the Service.
        </p>
      </Section>

      <Section title="2. Age Requirement">
        <p>
          The Service contains <strong>adult content</strong> and is
          strictly reserved for users <strong>18 years or older</strong>{' '}
          (or the legal age in your jurisdiction, whichever is higher).
        </p>
        <p>
          By using the Service you represent and warrant that you meet
          this requirement. We reserve the right to block access to any
          user who cannot verify their age.
        </p>
      </Section>

      <Section title="3. Nature of Content">
        <p>
          All characters, conversations and images are{' '}
          <strong>fictional works generated by artificial intelligence</strong>.
        </p>
        <ul>
          <li>
            They do not represent real persons, living or deceased, unless
            explicitly stated.
          </li>
          <li>
            They are not professional advice of any kind (medical, legal,
            psychological or financial).
          </li>
          <li>
            AI responses may contain inaccuracies or unexpected behavior.
          </li>
        </ul>
      </Section>

      <Section title="4. Acceptable Use">
        <p>You agree NOT to use the Service to:</p>
        <ul>
          <li>Engage in illegal activities or infringe third-party rights.</li>
          <li>
            Generate content involving minors, non-consensual real
            violence, or illegal acts.
          </li>
          <li>Harass, threaten, or impersonate others.</li>
          <li>
            Scrape, copy or reproduce the Service's content at scale.
          </li>
          <li>
            Reverse-engineer, perform automated scraping, or abuse the
            infrastructure.
          </li>
        </ul>
      </Section>

      <Section title="5. Characters and Third-Party Content">
        <p>
          All characters are fictional archetypes. We do not imitate or
          represent copyrighted characters, real celebrities or
          registered trademarks.
        </p>
        <p>
          If you believe any content infringes your rights, contact us at{' '}
          <strong>@TabooRealmSupport</strong> with supporting
          documentation and we will act within a reasonable timeframe.
        </p>
      </Section>

      <Section title="6. Purchases and Virtual Gems">
        <p>
          The Service offers <strong>virtual gems</strong> and{' '}
          <strong>subscriptions</strong> purchasable via Telegram Stars,
          cryptocurrency, or other supported methods.
        </p>
        <ul>
          <li>
            Gems are a virtual good with no monetary value outside the
            Service. Non-refundable except as required by law.
          </li>
          <li>
            Subscriptions auto-renew unless canceled before the next cycle.
          </li>
          <li>
            We may modify pricing with reasonable prior notice.
          </li>
        </ul>
      </Section>

      <Section title="7. Refunds">
        <p>
          Refunds are processed via Telegram (Stars) or the relevant
          provider (crypto). Since goods are digital and consumed
          immediately, we do not offer discretionary refunds except as
          required by law.
        </p>
        <p>
          If you experience a technical issue that prevented use of the
          Service, contact us and we will evaluate case by case.
        </p>
      </Section>

      <Section title="8. Account and Access">
        <p>
          Your account is linked to your Telegram identity. You are
          responsible for keeping your account secure.
        </p>
        <p>
          We may suspend or delete accounts violating these Terms,
          without prior notice.
        </p>
      </Section>

      <Section title="9. Limitation of Liability">
        <p>
          The Service is provided "as is". We do not guarantee continuous
          availability, accuracy of AI-generated content, or
          error-free operation.
        </p>
        <p>
          To the maximum extent permitted by law, we are not liable for
          indirect, incidental or consequential damages arising from use
          of the Service.
        </p>
      </Section>

      <Section title="10. Changes to Terms">
        <p>
          We may update these Terms. Material changes will be notified
          through the bot. Continued use after changes implies
          acceptance.
        </p>
      </Section>

      <Section title="11. Governing Law">
        <p>
          These Terms are governed by the applicable laws in the
          operator's jurisdiction. Any dispute will be resolved in the
          competent courts of that jurisdiction.
        </p>
      </Section>

      <Section title="12. Intellectual Property">
        <p>
          All content within the Service —including but not limited to
          characters, archetypes, text, generated images, interface,
          source code, logos and visual elements— is property of Taboo
          Realm or used under license.
        </p>
        <p>
          Copying, reproducing, distributing, modifying, selling,
          reselling, or commercially exploiting any part of the Service
          without prior written authorization is prohibited.
        </p>
      </Section>

      <Section title="13. Fair Use and VIP Quotas">
        <p>
          The VIP subscription includes the following monthly quotas,
          subject to the fair use rules described below:
        </p>
        <ul>
          <li>
            <strong>6,000 messages per month</strong> (up to 200/day,
            daily reset at 00:00 UTC)
          </li>
          <li>
            <strong>30 premium AI images per month</strong> (up to 1/day,
            accumulate up to a maximum of 5 in reserve)
          </li>
          <li>
            <strong>Up to 300 SFW images per month</strong> from our
            shared library
          </li>
          <li>
            <strong>18 exclusive characters</strong> with unique content
            and archetypes
          </li>
        </ul>
        <p>
          <strong>Accumulation rules:</strong> messages do not
          accumulate beyond the daily quota. Premium AI images do
          accumulate up to a maximum of <strong>5 in reserve</strong>;
          those exceeding this limit are lost after the sixth day of
          non-use.
        </p>
        <p>
          <strong>Fair use:</strong> quotas are personal and
          non-transferable. It is prohibited to use bots, scripts,
          automation, or external tools to bypass the limits, share
          credentials, or scrape and mass-extract content.
        </p>
        <p>
          <strong>Consequences of abuse:</strong> in case of proven
          abuse, we reserve the right to suspend or cancel the
          account without refund.
        </p>
        <p>
          <strong>AI-generated images:</strong> they are unique and
          may vary depending on context. We do not guarantee a
          specific image, only access to the generation system
          within the indicated quotas.
        </p>
        <p>
          <strong>Modifications:</strong> quotas may be adjusted
          with 30 days' prior notice through the bot. Continued use
          after the modification implies acceptance.
        </p>
      </Section>

      <Section title="14. Contact">
        <p>
          For any questions, support or claims: <strong>@TabooRealmSupport</strong>{' '}
          on Telegram.
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
