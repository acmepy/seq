# TASKS — Soporte multitenant por columna en SEQ

## Estado de implementación

- Implementados configuración `attribute`, resolución desde `getContext().tenantId` sin defaults ni conversiones, filtros CRUD obligatorios, validación de escrituras y referencias, instancias, asociaciones lazy/eager, tablas intermedias y operaciones anidadas.
- Implementados hash de caché por tenant y tipo, serialización de operadores `Symbol`, invalidaciones por tenant/dependencias/cascadas y vinculación de transacciones al contexto.
- Pruebas genéricas en `tests/tenant.test.js`, cargadas por `npm test` y por las suites de integración MySQL, Oracle 11 y Oracle 12. En esta etapa solo se ejecutan con SQLite, por indicación del usuario.
- README actualizado y ejemplo ejecutable verificado en `examples/tenant.js`.
- Pendientes la validación real en MySQL/Oracle, la integración de extremo a extremo con `api-kit` y la preparación de versión/notas de entrega. El contrato `getContext().tenantId` se verifica con contexto asíncrono en las pruebas genéricas.
- Redis y Memcached continúan siendo esqueletos sin implementación funcional en este repositorio. No se consideran validados por estas pruebas.
- Las restricciones UNIQUE y FK físicas requieren definición explícita por la aplicación; no se reescriben automáticamente restricciones existentes.

## 1. Objetivo

Incorporar soporte multitenant en `seq`, permitiendo que diferentes tenants compartan una misma base de datos y las mismas tablas, manteniendo el aislamiento de sus registros mediante una columna configurable.

La implementación debe aprovechar el mecanismo `getContext` existente y garantizar que las restricciones del tenant se apliquen automáticamente a todas las operaciones realizadas mediante los modelos.

## 2. Alcance

### Incluido

- MySQL.
- SQLite.
- Oracle 11g.
- Oracle 12.
- Tablas compartidas entre tenants.
- Atributo de tenant configurable, resuelto a columna física mediante la estrategia del adaptador.
- Aislamiento automático en operaciones CRUD.
- Compatibilidad con asociaciones y operaciones anidadas.
- Aislamiento de caché.
- Validación de operaciones masivas.
- Pruebas unitarias y de integración.

### Excluido

- Una base de datos por tenant.
- Una tabla o schema por tenant.
- Resolución dinámica de nombres de tablas.
- Sincronización individual por tenant.
- Administración de tenants.
- Autenticación y autorización de usuarios.
- Modificación automática de consultas SQL arbitrarias.

## 3. Configuración propuesta

### Configuración global

```js
const seq = new Seq({
  adapter,
  getContext,
  tenant: {
    attribute: 'tenantId'
  }
});
```

La configuración global declara el atributo que usarán los modelos con `tenant: true`. No existe un nombre de atributo implícito ni un identificador de tenant por defecto: el atributo debe configurarse explícitamente y el identificador se obtiene exclusivamente de `getContext().tenantId`, proporcionado por `api-kit`.

`attribute` identifica un atributo del modelo, no una columna SQL. Por ejemplo, `tenantId` puede resolverse a `tenant_id` según `field` y la estrategia de nombres del adaptador. El valor del contexto conserva su tipo de dato; `seq` no convierte números a cadenas ni cadenas a números para resolver o comparar tenants. `123` y `'123'` son identificadores distintos.

### Configuración por modelo

```js
class Cliente extends Model {
  static options = {
    tableName: 'clientes',
    tenant: true
  };
}
```

Un modelo puede utilizar un atributo diferente:

```js
class Venta extends Model {
  static options = {
    tableName: 'ventas',
    tenant: {
      attribute: 'codEmpresa'
    }
  };
}
```

Los modelos globales pueden excluirse:

```js
class Pais extends Model {
  static options = {
    tableName: 'paises',
    tenant: false
  };
}
```

**Compatibilidad:** los modelos existentes que no declaren `tenant` deben conservar su comportamiento actual. La protección multitenant debe ser explícita y no activarse silenciosamente en modelos existentes.

## 4. Fase 1 — Configuración y resolución del tenant

### MT-001 — Incorporar configuración multitenant en Seq

- [ ] Aceptar la propiedad `tenant` en el constructor de `Seq`.
- [ ] Validar que la configuración sea un objeto válido.
- [ ] Soportar `attribute` como nombre del atributo del modelo.
- [ ] No establecer valores implícitos para el atributo ni para el identificador del tenant.
- [ ] Obtener el identificador exclusivamente de `getContext().tenantId`.
- [ ] Mantener compatibilidad con configuraciones existentes.
- [ ] Actualizar las definiciones TypeScript.

**Archivos principales:**
- `src/core/Seq.js`
- `types/index.d.ts`

### MT-002 — Incorporar configuración multitenant por modelo

- [ ] Permitir `tenant: true`.
- [ ] Permitir `tenant: false`.
- [ ] Permitir `tenant: { attribute: '...' }`.
- [ ] Resolver la configuración efectiva combinando opciones globales y del modelo.
- [ ] Rechazar `tenant: true` cuando no exista un atributo global configurado; permitir configuración explícita por modelo sin configuración global.
- [ ] Validar que el atributo configurado exista entre los atributos persistentes del modelo y no sea virtual.
- [ ] Resolver su columna física usando el mapeo de atributos, `field` y la estrategia del adaptador.
- [ ] Impedir que un default del atributo sustituya un tenant ausente en el contexto.

**Archivo principal:** `src/core/Model.js`

### MT-003 — Implementar TenantResolver

- [ ] Crear un módulo encargado de resolver el tenant.
- [ ] Obtener el contexto mediante `seq._getContext`.
- [ ] Extraer el identificador de `context.tenantId`, establecido por `api-kit`.
- [ ] Aceptar identificadores válidos, incluido el valor numérico `0`.
- [ ] Rechazar valores `null`, `undefined` o inválidos.
- [ ] Conservar el tipo de dato del identificador; no aplicar coerciones al resolverlo o compararlo.
- [ ] Validar el valor contra el tipo declarado del atributo y rechazar incompatibilidades antes de consultar la base.
- [ ] No usar un tenant por defecto ni tomarlo de `values`, `where` u opciones suministradas por el cliente.
- [ ] Resolver el tenant al iniciar cada operación y conservarlo durante sus pasos internos, sin guardarlo como estado mutable compartido en `Model` o `Seq`.
- [ ] Lanzar un error específico cuando falte el tenant.
- [ ] Evitar que las operaciones dependan de un tenant enviado directamente por el cliente.

**Archivo sugerido:** `src/core/TenantResolver.js`

### MT-004 — Definir errores multitenant

- [ ] Crear un error para contexto de tenant ausente.
- [ ] Crear un error para configuración multitenant inválida.
- [ ] Crear un error para intentos de modificar el tenant de un registro.
- [ ] Utilizar códigos de error consistentes con los existentes.
- [ ] Exportar los errores desde el módulo correspondiente.

### MT-005 — Crear pruebas de configuración y contexto

- [ ] Verificar la resolución correcta del tenant.
- [ ] Verificar modelos con `tenant: true`.
- [ ] Verificar modelos con `tenant: false`.
- [ ] Verificar atributos personalizados y su mapeo a columnas físicas.
- [ ] Verificar ausencia de defaults y rechazo de configuración incompleta.
- [ ] Verificar el valor `0`, conservación de tipos y distinción entre `123` y `'123'`.
- [ ] Verificar ausencia del contexto.
- [ ] Verificar solicitudes concurrentes con tenants diferentes.
- [ ] Verificar que un contexto sin tenant no permita acceder a modelos protegidos.

**Archivo sugerido:** `tests/tenant-context.test.js`

---

## 5. Fase 2 — Aislamiento de consultas

### MT-006 — Implementar TenantQueryScope

Crear un mecanismo central que agregue la restricción del tenant a las consultas.

- [ ] Resolver el tenant del modelo.
- [ ] Construir una condición obligatoria.
- [ ] Combinarla con los filtros existentes utilizando `AND`.
- [ ] Preservar operadores lógicos `AND` y `OR`.
- [ ] Evitar la modificación de los objetos originales.
- [ ] Impedir que un filtro proporcionado por el usuario sustituya la condición obligatoria.
- [ ] Compartir la resolución y composición del aislamiento entre `Model` y DML para evitar reglas divergentes.

**Archivo sugerido:** `src/core/TenantQueryScope.js`

Ejemplo conceptual:

```js
const where = {
  [Op.or]: [
    { estado: 'PENDIENTE' },
    { estado: 'PROCESADO' }
  ]
};
```

Debe producir una condición equivalente a:

```sql
WHERE tenant_id = ?
  AND (
    estado = 'PENDIENTE'
    OR estado = 'PROCESADO'
  )
```

### MT-007 — Aplicar aislamiento en SELECT

- [ ] Proteger `findAll`.
- [ ] Proteger `findOne`.
- [ ] Proteger `findByPk`.
- [ ] Proteger `findAndCountAll`.
- [ ] Proteger la búsqueda de `findOrCreate` con el tenant del contexto.
- [ ] Proteger consultas con paginación.
- [ ] Proteger consultas con ordenamiento.
- [ ] Proteger consultas con selección parcial de atributos.

**Archivos principales:**
- `src/core/Model.js`
- `src/adapters/abstract/DMLAbstract.js`

### MT-008 — Aplicar aislamiento en COUNT

- [ ] Aplicar el filtro obligatorio en `count`.
- [ ] Mantener compatibilidad con filtros existentes.
- [ ] Mantener compatibilidad con asociaciones.
- [ ] Verificar que los totales correspondan únicamente al tenant actual.

### MT-009 — Aplicar aislamiento en UPDATE

- [ ] Incorporar automáticamente el tenant en el `WHERE`.
- [ ] Impedir actualizar registros pertenecientes a otro tenant.
- [ ] Impedir modificar la columna de tenant.
- [ ] Validar operaciones que modifiquen claves primarias.
- [ ] Mantener el aislamiento durante consultas previas y posteriores al UPDATE.

### MT-010 — Aplicar aislamiento en DELETE

- [ ] Incorporar automáticamente el tenant en el `WHERE`.
- [ ] Impedir eliminar registros pertenecientes a otro tenant.
- [ ] Mantener el aislamiento en eliminaciones mediante instancias.
- [ ] Mantener el aislamiento en eliminaciones masivas.
- [ ] Verificar las operaciones de eliminación en cascada gestionadas por `seq`.

### MT-011 — Aplicar aislamiento en INSERT

- [ ] Incorporar automáticamente la columna de tenant.
- [ ] Utilizar el valor obtenido del contexto.
- [ ] Rechazar valores de tenant diferentes al contexto.
- [ ] Permitir valores coincidentes con el contexto.
- [ ] Comparar el valor proporcionado y el del contexto sin conversiones de tipo.
- [ ] Proteger la creación de `findOrCreate` y `build().save()` con el tenant vigente al ejecutar la operación de persistencia.
- [ ] Mantener los valores predeterminados de los demás atributos; el tenant siempre procede del contexto.
- [ ] Mantener compatibilidad con claves autoincrementales.

### MT-012 — Aplicar aislamiento en operaciones masivas

- [ ] Proteger `bulkCreate` o su equivalente.
- [ ] Proteger `bulkInsert`.
- [ ] Proteger actualizaciones masivas.
- [ ] Proteger eliminaciones masivas.
- [ ] Validar cada registro antes de una inserción múltiple.
- [ ] Evitar inserciones parciales cuando existan errores de tenant.

### MT-013 — Aplicar aislamiento en UPSERT

- [ ] Proteger la búsqueda del registro existente.
- [ ] Incorporar el tenant en los criterios de coincidencia.
- [ ] Impedir actualizar registros de otros tenants.
- [ ] Incorporar el tenant en nuevos registros.
- [ ] Revisar las restricciones UNIQUE utilizadas para detectar conflictos.
- [ ] Evitar que una coincidencia por clave global produzca una modificación cruzada.
- [ ] Ante un conflicto con un registro ajeno, fallar sin modificarlo; el tenant del contexto nunca puede sustituirse por el del registro conflictivo.

**Archivo principal:** `src/adapters/abstract/DMLAbstract.js`

### MT-014 — Restringir TRUNCATE

- [ ] Rechazar `truncate()` sobre modelos multitenant.
- [ ] Mantener `truncate()` para modelos no protegidos.
- [ ] Proporcionar un mensaje de error claro.
- [ ] Verificar el comportamiento en SQLite, MySQL, Oracle 11 y Oracle 12.

### MT-015 — Evitar bypass mediante hooks

- [ ] Garantizar que `hooks: false` no desactive el aislamiento.
- [ ] Aplicar las restricciones en una capa obligatoria.
- [ ] En `Model`, resolver y validar el tenant antes de leer la caché, incluso cuando la operación termine en un cache hit.
- [ ] En DML, imponer el filtro y validar escrituras antes de ejecutar SQL, incluyendo consultas internas y métodos sobrescritos por los adaptadores.
- [ ] Revalidar filtros y valores después de los hooks para que estos no eliminen ni sustituyan el aislamiento obligatorio.
- [ ] Verificar operaciones ejecutadas directamente desde los modelos.
- [ ] Verificar operaciones ejecutadas desde los adaptadores cuando formen parte de la API pública.
- [ ] Documentar los límites de protección de consultas SQL arbitrarias.

La regla es compartida y se aplica en dos puntos del recorrido. La validación en `Model` protege el acceso a caché; la aplicación en DML protege la ejecución contra la base, incluidas llamadas internas que no pasan por los métodos de `Model`. No debe implementarse únicamente como un hook ni depender de `hooks: true`.

### MT-016 — Crear pruebas de aislamiento CRUD

- [ ] Crear registros de dos tenants.
- [ ] Verificar que cada tenant consulte únicamente sus registros.
- [ ] Verificar `findByPk` con identificadores de otro tenant.
- [ ] Verificar UPDATE cruzado.
- [ ] Verificar DELETE cruzado.
- [ ] Verificar INSERT con tenant incorrecto.
- [ ] Verificar UPSERT con coincidencias de otro tenant.
- [ ] Verificar operaciones con `hooks: false`.
- [ ] Verificar que los modelos globales funcionen sin tenant.
- [ ] Verificar `findOrCreate`, `build().save()` y operaciones sobre instancias cargadas bajo un tenant diferente al contexto vigente.
- [ ] Verificar que un conflicto UNIQUE con otro tenant falle sin modificar registros ajenos.

**Archivo sugerido:** `tests/tenant-crud.test.js`

---

## 6. Fase 3 — Asociaciones y operaciones anidadas

### MT-017 — Revisar asociaciones entre modelos

- [ ] Revisar `belongsTo`.
- [ ] Revisar `hasOne`.
- [ ] Revisar `hasMany`.
- [ ] Revisar `belongsToMany`.
- [ ] Identificar modelos protegidos y modelos globales.
- [ ] Definir el comportamiento de asociaciones entre ambos tipos.

Ejemplo requerido: `Pais` y `Ciudad` globales conservan su relación por país. Al incluir `Cliente` protegido, se recuperan únicamente los clientes relacionados con ese país y pertenecientes a `getContext().tenantId`. Cada modelo protegido se filtra con el tenant del contexto, aunque la raíz o un modelo intermedio sea global. Una consulta de modelos globales sin asociaciones protegidas puede ejecutarse sin tenant.

**Archivos principales:**
- `src/core/Association.js`
- `src/adapters/abstract/DMLAbstract.js`

### MT-018 — Proteger consultas con JOIN

- [ ] Aplicar el tenant a cada modelo protegido de la consulta.
- [ ] Conservar los filtros relacionales de país/ciudad/cliente y combinarlos con el tenant del contexto en cada modelo protegido.
- [ ] Incorporar correctamente las condiciones en los JOIN.
- [ ] Preservar la semántica de LEFT JOIN.
- [ ] Preservar las consultas con `required: true`.
- [ ] Proteger asociaciones anidadas.
- [ ] Evitar asociaciones cruzadas entre tenants.

**Importante:** en un LEFT JOIN, las condiciones del tenant del modelo relacionado generalmente deben formar parte de la condición `ON`, no del `WHERE` principal, para no convertir accidentalmente la consulta en un INNER JOIN.

### MT-019 — Proteger asociaciones cargadas de forma diferida

- [ ] Aplicar el tenant en cargas lazy.
- [ ] Proteger consultas adicionales de asociaciones.
- [ ] Verificar asociaciones anidadas.
- [ ] Mantener la propagación del contexto durante operaciones asíncronas.

### MT-020 — Proteger creaciones anidadas

- [ ] Incorporar el tenant en el modelo principal.
- [ ] Incorporar el tenant en los modelos de detalle.
- [ ] Obtener siempre ambos valores del contexto, incluso cuando principal y detalle usen atributos de tenant diferentes.
- [ ] Impedir que un detalle pertenezca a otro tenant.
- [ ] Mantener la transacción de la operación.
- [ ] Validar relaciones maestro-detalle.

### MT-021 — Proteger actualizaciones anidadas

- [ ] Aplicar el tenant a búsquedas de detalles.
- [ ] Aplicar el tenant a actualizaciones de detalles.
- [ ] Aplicar el tenant a eliminaciones de detalles.
- [ ] Evitar que una clave foránea permita acceder a registros de otro tenant.
- [ ] Verificar UPSERT anidado.

### MT-022 — Revisar tablas intermedias

- [ ] Identificar tablas intermedias generadas por `belongsToMany`.
- [ ] Definir cómo se aplica el tenant en estas tablas.
- [ ] Aplicar el tenant del contexto a las escrituras de relaciones protegidas y validar que sus extremos protegidos pertenezcan a ese tenant.
- [ ] Impedir relaciones entre registros de tenants diferentes.
- [ ] Revisar claves compuestas y restricciones UNIQUE.
- [ ] Verificar operaciones de creación y eliminación de relaciones.

### MT-023 — Crear pruebas de asociaciones

- [ ] Probar asociaciones simples.
- [ ] Probar asociaciones anidadas.
- [ ] Probar LEFT JOIN.
- [ ] Probar INNER JOIN.
- [ ] Probar relaciones muchos a muchos.
- [ ] Probar creaciones anidadas.
- [ ] Probar actualizaciones anidadas.
- [ ] Probar eliminación de detalles.
- [ ] Verificar que no existan registros relacionados de otros tenants.
- [ ] Probar `Pais`/`Ciudad` globales asociados a `Cliente` protegido: conservar las relaciones y filtrar clientes por el tenant del contexto en lazy y eager.

**Archivo sugerido:** `tests/tenant-associations.test.js`

---

## 7. Fase 4 — Caché, transacciones y estructura

### MT-024 — Incorporar tenant a las claves de caché

- [ ] Incluir siempre el identificador de `getContext().tenantId` y su tipo en los datos usados para calcular el hash de toda clave de caché, incluidos modelos globales y consultas sin asociaciones.
- [ ] Corregir la serialización de operadores `Symbol` (`Op.and`, `Op.or`, etc.) para que los filtros completos participen en el hash.
- [ ] Mantener separadas las consultas de tenants diferentes.
- [ ] Aplicar esta regla sin inspeccionar si los modelos o sus asociaciones tienen configuración o atributos de tenant.
- [ ] Mantener las consultas exclusivamente globales disponibles sin tenant: representar explícitamente la ausencia en el hash sin asignar un tenant por defecto ni colisionar con identificadores válidos.
- [ ] Resolver y validar el tenant antes de cualquier lectura de caché cuando la raíz o alguna asociación estén protegidas.
- [ ] Evitar que consultas equivalentes de diferentes tenants compartan resultados.
- [ ] Revisar `findOne`, `findAll` y `count`.

Decisión: todas las claves de caché dependen del tenant del contexto. Los resultados globales también se almacenan por separado para cada tenant; se acepta esa duplicación para simplificar la regla y cubrir automáticamente las consultas con asociaciones protegidas.

**Archivos principales:**
- `src/core/Model.js`
- `src/cache/Cache.js`
- `src/cache/utils.js`

### MT-025 — Aislar invalidaciones de caché

- [ ] Invalidar las entradas correspondientes al tenant actual.
- [ ] Evitar invalidaciones cruzadas innecesarias.
- [ ] Mantener invalidaciones globales cuando corresponda.
- [ ] Al modificar datos globales, invalidar las entradas dependientes de esos datos en todas las particiones de tenant, ya que las consultas globales también se cachean por tenant.
- [ ] Revisar invalidaciones después de transacciones.
- [ ] Usar el tenant capturado por la escritura al invalidar después del commit, aunque el contexto de la llamada posterior sea diferente.
- [ ] Revisar la invalidación de resultados con raíz global que incluyan modelos protegidos modificados.
- [ ] Verificar adaptadores Map, Redis y Memcached cuando estén disponibles.

### MT-026 — Proteger transacciones

- [ ] Mantener el tenant durante toda la transacción.
- [ ] Vincular el tenant de `getContext().tenantId` a la transacción y conservar su tipo sin conversiones.
- [ ] Verificar operaciones múltiples sobre diferentes modelos.
- [ ] Verificar transacciones con asociaciones.
- [ ] Evitar reutilizar una transacción con un contexto de tenant diferente.
- [ ] Mantener el aislamiento en commit y rollback.
- [ ] Distinguir solicitudes concurrentes de transacciones concurrentes: respetar las limitaciones actuales de cada adaptador y rechazar reutilizaciones entre tenants.

### MT-027 — Revisar restricciones UNIQUE

- [ ] Documentar que las claves de negocio pueden necesitar incluir el tenant.
- [ ] Revisar índices UNIQUE existentes.
- [ ] Revisar claves primarias compuestas.
- [ ] Verificar operaciones UPSERT con claves compuestas.
- [ ] Evitar conflictos entre tenants por restricciones globales.

Ejemplo:

```sql
UNIQUE (tenant_id, codigo)
```

### MT-028 — Revisar claves foráneas

- [ ] Evaluar claves foráneas compuestas con tenant.
- [ ] Impedir referencias entre registros de tenants diferentes.
- [ ] Usar el tenant del contexto en las escrituras y validar que toda referencia a un modelo protegido pertenezca a ese mismo tenant; asignar el tenant al registro nuevo no basta para validar una FK ajena.
- [ ] Revisar relaciones maestro-detalle.
- [ ] Revisar eliminaciones y actualizaciones en cascada.
- [ ] Documentar limitaciones de esquemas existentes.

### MT-029 — Revisar sincronización de modelos

- [ ] Mantener `seq.sync()` funcionando con tablas compartidas.
- [ ] Verificar columnas de tenant declaradas explícitamente.
- [ ] Evitar modificaciones automáticas destructivas.
- [ ] Revisar generación de índices.
- [ ] Revisar restricciones y claves foráneas.
- [ ] Mantener compatibilidad con modelos sin tenant.

**Archivo principal:** `src/core/Seq.js`

### MT-030 — Crear pruebas de caché y transacciones

- [ ] Verificar consultas equivalentes entre tenants.
- [ ] Verificar hashes distintos para tenants distintos y para identificadores de distinto tipo, además de filtros con operadores `Symbol`.
- [ ] Verificar caché de `Pais` global con includes de clientes protegidos entre tenants.
- [ ] Verificar hashes distintos entre tenants también para consultas de modelos globales sin includes.
- [ ] Verificar consultas globales sin contexto y su separación de cualquier tenant válido.
- [ ] Verificar que cambios en datos globales invaliden sus resultados cacheados para todos los tenants.
- [ ] Verificar invalidación después de INSERT.
- [ ] Verificar invalidación después de UPDATE.
- [ ] Verificar invalidación después de DELETE.
- [ ] Verificar commit.
- [ ] Verificar rollback.
- [ ] Verificar concurrencia entre tenants.

---

## 8. Fase 5 — Compatibilidad con motores

### MT-031 — Validar SQLite

- [ ] Verificar SELECT con tenant.
- [ ] Verificar INSERT, UPDATE y DELETE.
- [ ] Verificar UPSERT.
- [ ] Verificar JOIN y asociaciones.
- [ ] Verificar restricciones UNIQUE compuestas.
- [ ] Verificar transacciones.
- [ ] Verificar sincronización de modelos.

### MT-032 — Validar MySQL

- [ ] Verificar SELECT con tenant.
- [ ] Verificar INSERT, UPDATE y DELETE.
- [ ] Verificar UPSERT.
- [ ] Verificar JOIN y asociaciones.
- [ ] Verificar restricciones UNIQUE compuestas.
- [ ] Verificar transacciones.
- [ ] Verificar sincronización de modelos.

### MT-033 — Validar Oracle 11g

- [ ] Verificar SELECT con tenant.
- [ ] Verificar INSERT, UPDATE y DELETE.
- [ ] Verificar UPSERT.
- [ ] Verificar JOIN y asociaciones.
- [ ] Verificar restricciones UNIQUE compuestas.
- [ ] Verificar claves primarias generadas mediante secuencias.
- [ ] Verificar transacciones.
- [ ] Verificar sincronización de modelos.

### MT-033B — Validar Oracle 12

- [ ] Verificar SELECT, INSERT, UPDATE, DELETE y UPSERT con tenant.
- [ ] Verificar JOIN, asociaciones lazy/eager y escrituras anidadas.
- [ ] Verificar restricciones UNIQUE compuestas y referencias protegidas.
- [ ] Verificar claves primarias generadas, transacciones y sincronización de modelos.

### MT-034 — Mantener independencia de dialecto

- [ ] Concentrar la lógica de aislamiento en componentes compartidos.
- [ ] Evitar duplicar reglas multitenant en cada adaptador.
- [ ] Utilizar los mecanismos existentes de parámetros SQL.
- [ ] Respetar el mapeo entre atributos y columnas físicas.
- [ ] Incorporar modificaciones específicas de dialecto solamente cuando sean necesarias.

### MT-035 — Ejecutar pruebas de regresión

- [ ] Ejecutar las pruebas existentes de SQLite.
- [ ] Ejecutar las pruebas existentes de MySQL.
- [ ] Ejecutar las pruebas existentes de Oracle 11.
- [ ] Ejecutar las pruebas existentes de Oracle 12.
- [ ] Cargar todas las pruebas comunes de tenant tanto desde `npm test` como desde `test:mysql`, `test:oracle11` y `test:oracle12`, usando `createTestContext()` y `testAdapterName()`.
- [ ] Ejecutar las pruebas de asociaciones.
- [ ] Ejecutar las pruebas de caché.
- [ ] Ejecutar las pruebas de transacciones.
- [ ] Verificar compatibilidad con modelos sin configuración multitenant.

---

## 9. Fase 6 — Integración, documentación y entrega

### MT-036 — Crear ejemplos de modelos multitenant

- [ ] Crear un modelo con `tenant: true`.
- [ ] Crear un modelo con atributo de tenant personalizado y su mapeo físico.
- [ ] Crear un modelo global con `tenant: false`.
- [ ] Crear ejemplos con asociaciones.
- [ ] Mostrar consultas y operaciones CRUD.

**Directorio sugerido:** `examples/`

### MT-037 — Crear ejemplo de contexto

- [ ] Mostrar cómo proporcionar `getContext`.
- [ ] Mostrar cómo establecer el tenant.
- [ ] Mostrar `getContext().tenantId` provisto por `api-kit`, sin valores por defecto ni conversiones.
- [ ] Mostrar operaciones simultáneas de diferentes tenants.
- [ ] Explicar que el tenant debe provenir de una fuente autenticada y confiable.

### MT-038 — Actualizar documentación

- [ ] Documentar configuración global.
- [ ] Documentar configuración por modelo.
- [ ] Documentar atributo personalizado y resolución de columna mediante el adaptador.
- [ ] Documentar modelos globales.
- [ ] Documentar comportamiento ante contexto ausente.
- [ ] Documentar aislamiento de caché.
- [ ] Documentar restricciones de operaciones SQL directas.

**Archivo principal:** `README.md`

### MT-039 — Actualizar definiciones TypeScript

- [ ] Incorporar opciones globales de tenant.
- [ ] Incorporar opciones de tenant por modelo.
- [ ] Definir tipos para configuración.
- [ ] Ampliar el tipo de retorno de `getContext` para incluir `tenantId` conservando el soporte existente de `txId`.
- [ ] Documentar errores multitenant.
- [ ] Mantener compatibilidad con tipos existentes.

**Archivo principal:** `types/index.d.ts`

### MT-040 — Crear pruebas de integración con api-kit

- [ ] Utilizar el mecanismo `getContext` de `api-kit`.
- [ ] Verificar propagación del tenant.
- [ ] Verificar consultas de modelos.
- [ ] Verificar operaciones maestro-detalle.
- [ ] Verificar solicitudes concurrentes.
- [ ] Verificar que un tenant no pueda acceder a datos de otro.

### MT-041 — Verificar compatibilidad hacia atrás

- [ ] Verificar aplicaciones existentes sin configuración multitenant.
- [ ] Verificar modelos sin propiedad `tenant`.
- [ ] Verificar operaciones CRUD tradicionales.
- [ ] Verificar asociaciones existentes.
- [ ] Verificar caché sin multitenancy.
- [ ] Evitar cambios incompatibles en la API pública.

### MT-042 — Revisar seguridad del aislamiento

- [ ] Verificar que ninguna operación protegida funcione sin tenant.
- [ ] Verificar que `hooks: false` no omita restricciones.
- [ ] Verificar filtros con operadores lógicos complejos.
- [ ] Verificar claves primarias de otros tenants.
- [ ] Verificar asociaciones cruzadas.
- [ ] Verificar operaciones masivas.
- [ ] Verificar caché compartida.
- [ ] Verificar transacciones concurrentes.

### MT-043 — Preparar versión y notas de cambios

- [ ] Documentar la nueva funcionalidad.
- [ ] Documentar opciones de configuración.
- [ ] Documentar cambios de comportamiento.
- [ ] Documentar limitaciones conocidas.
- [ ] Actualizar versión siguiendo la política del proyecto.

### MT-044 — Validación final

- [ ] Todas las pruebas existentes pasan.
- [ ] Todas las pruebas multitenant pasan.
- [ ] SQLite validado.
- [ ] MySQL validado.
- [ ] Oracle 11 validado.
- [ ] Oracle 12 validado.
- [ ] Documentación actualizada.
- [ ] Definiciones TypeScript actualizadas.
- [ ] Compatibilidad hacia atrás verificada.

---

## 10. Criterios de aceptación

La implementación se considerará terminada cuando:

1. Dos tenants puedan compartir las mismas tablas sin acceder a registros ajenos.
2. El tenant se obtenga exclusivamente de `getContext().tenantId`, sin defaults ni conversiones de tipo.
3. Los modelos protegidos rechacen operaciones cuando no exista un tenant válido.
4. SELECT, INSERT, UPDATE, DELETE y UPSERT respeten el aislamiento.
5. Las asociaciones y operaciones anidadas no permitan referencias cruzadas.
6. La caché no comparta resultados entre tenants.
7. Las transacciones mantengan el contexto correcto.
8. Los modelos globales funcionen sin restricciones propias y sus asociaciones protegidas se filtren con el tenant del contexto.
9. Los modelos existentes continúen funcionando sin modificaciones.
10. Las pruebas se ejecuten correctamente en MySQL, SQLite, Oracle 11g y Oracle 12.
11. `attribute` se resuelva a columna física según el mapeo y la estrategia del adaptador.
12. `findOrCreate`, `build().save()` y todas las escrituras protegidas usen el tenant del contexto, y los conflictos con registros ajenos fallen sin modificarlos.
13. Toda clave de caché incluya en su hash el identificador del tenant del contexto y su tipo, independientemente de los modelos o asociaciones consultados; la ausencia de tenant se represente explícitamente para consultas globales permitidas.

## 11. Orden recomendado de implementación

| Orden | Fase | Objetivo |
|---|---|---|
| 1 | Fase 1 | Configuración y resolución del tenant |
| 2 | MT-024 (Fase 4) | Corregir serialización de filtros y hash de caché por tenant antes de habilitar consultas protegidas con caché |
| 3 | Fase 2 | Aislamiento CRUD obligatorio |
| 4 | Fase 3 | Asociaciones y operaciones anidadas |
| 5 | Resto de Fase 4 | Invalidaciones de caché, transacciones y restricciones |
| 6 | Fase 5 | Compatibilidad con motores |
| 7 | Fase 6 | Documentación, integración y validación |

## 12. Consideraciones de diseño

**Seguridad por defecto:** un modelo protegido nunca debe ejecutar una operación sin un tenant válido.

**Responsabilidad:** `api-kit` determina el tenant autenticado; `seq` impone el aislamiento de datos.

**Contexto:** `api-kit` expone `tenantId` mediante `getContext`. Ese identificador, con su tipo original, es la única fuente del tenant para las operaciones protegidas. No hay tenant por defecto.

**Atributo:** la configuración usa `attribute`, nunca un nombre de columna SQL; la resolución física corresponde al adaptador.

**Compatibilidad:** la funcionalidad debe ser optativa para no afectar aplicaciones existentes.

**Centralización:** evitar implementar el filtro de tenant por separado en cada método público o dialecto cuando pueda resolverse en una capa compartida.

**SQL directo:** las consultas SQL arbitrarias que no pasen por la capa protegida del modelo quedan fuera de la garantía automática de aislamiento y deben documentarse como operaciones privilegiadas.

**Integridad:** los filtros automáticos no reemplazan las restricciones UNIQUE y FOREIGN KEY necesarias para impedir referencias cruzadas entre tenants.
