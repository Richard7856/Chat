/**
 * Script de un solo uso: genera un par de claves VAPID para Web Push.
 *
 * Uso:
 *   pnpm --filter @euromex/api run generate-vapid
 *
 * Copia la salida al .env del servidor (o a las variables de entorno de
 * producción). No necesitas volver a ejecutar esto a menos que quieras
 * rotar las claves (lo que invalida todas las suscripciones existentes).
 */

import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("=== VAPID Keys (copy to .env) ===\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:admin@euromex.com.mx`);
console.log("\n=== Public key for the frontend (apps/web) ===\n");
console.log(`NEXT_PUBLIC_VAPID_KEY=${keys.publicKey}`);
