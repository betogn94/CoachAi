// QA personas — pre-defined user variants for the e2e harness.
//
// 'testb' uses the existing TestB account in the DB (skips onboarding —
// good for fast smoke runs against either local or prod). The qa1..qa3
// personas are designed for fresh-user runs (onboarding flow + cleanup).
// Phase 0 uses 'testb' only; qa1..qa3 are wired for Phase 1 expansion.

module.exports = {
  testb: {
    nombre: 'TestB',
    email: 'testb@test.com',
    skipOnboarding: true, // already in DB with profile + foto inicio
  },
  qa1: {
    nombre: 'QA Hyper',
    email: 'qa-hyper@coachai-qa.test',
    skipOnboarding: false,
    onboarding: {
      objetivo: 'hipertrofia',
      nivel: 'intermedio',
      dias: ['lun', 'mar', 'jue', 'vie'],
      comidas: '4',
      edad: 28, sexo: 'M', peso: 78, altura: 180,
      cuello: 38, cintura: 84, cadera: 96,
      actividad: 'moderada',
      duracion_sesion: '60min',
      lugar_entreno: 'gimnasio',
      lesiones: [],
      restricciones_dieta: [],
      alergias: [],
    },
  },
  qa2: {
    nombre: 'QA Define',
    email: 'qa-define@coachai-qa.test',
    skipOnboarding: false,
    onboarding: {
      objetivo: 'definir',
      nivel: 'inicial',
      dias: ['mar', 'jue', 'sab'],
      comidas: '3',
      edad: 35, sexo: 'F', peso: 62, altura: 168,
      cuello: 32, cintura: 72, cadera: 96,
      actividad: 'ligera',
      duracion_sesion: '45min',
      lugar_entreno: 'casa',
      lesiones: ['rodilla'],
      restricciones_dieta: ['vegetariana'],
      alergias: [],
    },
  },
  qa3: {
    nombre: 'QA Lose',
    email: 'qa-lose@coachai-qa.test',
    skipOnboarding: false,
    onboarding: {
      objetivo: 'perdida_grasa',
      nivel: 'avanzado',
      dias: ['lun', 'mar', 'mie', 'jue', 'vie'],
      comidas: '5',
      edad: 42, sexo: 'M', peso: 92, altura: 175,
      cuello: 42, cintura: 102, cadera: 104,
      actividad: 'intensa',
      duracion_sesion: '75min',
      lugar_entreno: 'gimnasio',
      lesiones: [],
      restricciones_dieta: [],
      alergias: ['lacteos'],
    },
  },
};
