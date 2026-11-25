// Configuración de Jest. Es .cjs porque package.json tiene "type": "module".
// ts-jest compila los .ts a CommonJS solo para las pruebas; el código de la app no cambia.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node10',
          types: ['node', 'jest'],
        },
      },
    ],
  },
  // Ninguna prueba puede tardar mucho: no hay red ni Gemini real.
  testTimeout: 5000,
};
