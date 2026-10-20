const {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
} = require('libphonenumber-js');
const { HttpError } = require('../utils/http');

// Country metadata comes from libphonenumber, so every country and territory is
// covered and the calling codes stay correct without a hand-maintained table.
// A hand-written list drifts: countries split, codes get reassigned.
function listCountries(locale = 'es') {
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });

  return getCountries()
    .map((code) => ({
      code,
      name: regionNames.of(code) || code,
      dialCode: `+${getCountryCallingCode(code)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/**
 * Normalise a phone number to E.164, or reject it.
 *
 * The client sends the country it displayed in the picker, but the number
 * itself may already carry a `+` prefix. When it does, that wins: a user who
 * typed `+34 600…` while the picker said "Mexico" means Spain, and silently
 * prepending +52 would send their code to a stranger's phone.
 */
function normalizePhone(raw, defaultCountry) {
  if (!raw || typeof raw !== 'string') {
    throw new HttpError(400, 'Número de teléfono requerido');
  }

  const trimmed = raw.trim();
  const hasPrefix = trimmed.startsWith('+');
  const country = normalizeCountry(defaultCountry);

  const parsed = parsePhoneNumberFromString(
    trimmed,
    // Only consult the fallback country when there is no explicit prefix.
    hasPrefix ? undefined : country
  );

  if (!parsed || !parsed.isValid()) {
    // Naming the country matters: the picker has 245 entries, and a bare
    // "invalid number" leaves the user with no idea that the wrong country is
    // selected. Suggesting the international prefix is the fix that always
    // works, whatever the picker says.
    const assumed = country ? ` para ${country} (+${getCountryCallingCode(country)})` : '';
    throw new HttpError(
      400,
      `Número de teléfono inválido${assumed}. Revisa el país seleccionado o escribe el número con prefijo internacional, por ejemplo +34…`
    );
  }

  return parsed.number; // E.164, e.g. +525512345678
}

function normalizeCountry(country) {
  if (!country || typeof country !== 'string') return undefined;
  const upper = country.trim().toUpperCase();
  return getCountries().includes(upper) ? upper : undefined;
}

// Mask all but the last two digits for display and logs. A full number in a log
// line or an error message is a privacy leak.
function maskPhone(e164) {
  if (!e164 || e164.length < 3) return '***';
  return `${'*'.repeat(Math.max(0, e164.length - 4))}${e164.slice(-2)}`;
}

module.exports = { listCountries, normalizePhone, normalizeCountry, maskPhone };
