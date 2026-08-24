# Instrucciones del repositorio

## Pruebas entre adaptadores

- Toda prueba de comportamiento común del ORM debe ejecutarse con SQLite, MySQL, Oracle 11 y Oracle 12.
- Coloca esas pruebas en archivos que cargan tanto `npm test` como las suites de integración (`test:mysql`, `test:oracle11` y `test:oracle12`), usando el adaptador activo a través de `createTestContext()` y `testAdapterName()`.
- No simules MySQL u Oracle dentro de una prueba que se ejecuta únicamente con SQLite cuando el comportamiento pueda verificarse contra la base real.
- Reserva las pruebas específicas de un adaptador para sintaxis SQL o capacidades exclusivas de ese motor.
- Al modificar comportamiento compartido, ejecuta `npm test`; ejecuta además la suite de integración del adaptador afectado cuando el servicio esté disponible.


# Dependencias externas

- Las dependencias externas son la fuente de verdad de su API, sus tipos, sus nombres y sus convenciones.
- No crear aliases, adaptadores de compatibilidad ni conversiones de nombres para ajustar una dependencia al código del proyecto.
- Cuando una dependencia cambie o exponga una interfaz distinta, actualizar el código consumidor y sus pruebas para usar esa interfaz directamente.

## Documentación

Solo actualizar el README para documentar funcionalidades ya implementadas y verificadas.
No agregar ejemplos, opciones ni comportamiento futuro/no probado.