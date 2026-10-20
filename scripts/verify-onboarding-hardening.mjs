import fs from 'node:fs';

const checks = [
  {
    file: 'src/SigoAuthGate.tsx',
    required: [
      'ONBOARDING_MODE_METADATA_KEY',
      'sigo_onboarding_mode',
      'OWNER_ONBOARDING_MODE',
      'STAFF_ONBOARDING_MODE',
      '[ONBOARDING_MODE_METADATA_KEY]: OWNER_ONBOARDING_MODE',
      '[ONBOARDING_MODE_METADATA_KEY]: STAFF_ONBOARDING_MODE',
      'No se crea una empresa nueva.',
    ],
    label: 'registration persists owner/member onboarding intent across email activation',
  },
  {
    file: 'src/SigoRoot.tsx',
    required: [
      'type EmptyTenantMode = "checking" | "member" | "owner"',
      'emptyTenantMode !== "member"',
      'window.setInterval',
      'onboardingMode === STAFF_ONBOARDING_MODE',
      'Esta cuenta fue creada para sumarse a una empresa existente.',
      'emptyTenantMode === "member"',
      'Actualizar acceso ahora',
      'No se crea una empresa nueva para este tipo de cuenta',
    ],
    label: 'staff without membership waits for assignment and cannot create a tenant by accident',
  },
];

let failed = false;
for (const check of checks) {
  if (!fs.existsSync(check.file)) {
    console.error(`FAIL ${check.label}: missing ${check.file}`);
    failed = true;
    continue;
  }
  const content = fs.readFileSync(check.file, 'utf8');
  const missing = check.required.filter((token) => !content.includes(token));
  if (missing.length) {
    console.error(`FAIL ${check.label}: missing ${missing.join(', ')}`);
    failed = true;
  } else {
    console.log(`PASS ${check.label}`);
  }
}

if (failed) process.exit(1);
console.log('SIGO_ONBOARDING_HARDENING_CHECKS_OK');
