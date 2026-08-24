# Instrucciones del repositorio

## Pruebas entre adaptadores

- Toda prueba de comportamiento común del ORM debe ejecutarse con SQLite, MySQL, Oracle 11 y Oracle 12.
- Coloca esas pruebas en archivos que cargan tanto `npm test` como las suites de integración (`test:mysql`, `test:oracle11` y `test:oracle12`), usando el adaptador activo a través de `createTestContext()` y `testAdapterName()`.
- No simules MySQL u Oracle dentro de una prueba que se ejecuta únicamente con SQLite cuando el comportamiento pueda verificarse contra la base real.
- Reserva las pruebas específicas de un adaptador para sintaxis SQL o capacidades exclusivas de ese motor.
- Al modificar comportamiento compartido, ejecuta `npm test`; ejecuta además la suite de integración del adaptador afectado cuando el servicio esté disponible.
