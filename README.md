# Atlantic Ocean Calendar

Aplicación web para la exploración temporal y espacial de perfiles hidrográficos Argo del océano Atlántico. Presenta estadísticos de temperatura y salinidad en función de la fecha, la región y el intervalo de profundidad.

El periodo y los años disponibles se leen de [`data/manifest.json`](./data/manifest.json).

## Datos y metodología

Los datos proceden de perfiles Argo exportados desde Ocean Data View (webODV). El procesamiento utiliza presión ajustada (`Pressure_adjusted_`), temperatura ajustada (`Temperature_adjusted_`) y salinidad práctica ajustada (`Practical_Salinity_adjusted_`).

Los perfiles se agrupan por día, celdas geográficas de 5° × 5° y cinco intervalos de presión: 0–200, 200–500, 500–1000, 1000–1500 y 1500–2000 dbar. Estos intervalos se muestran como aproximaciones de profundidad en metros; no se aplica una conversión presión-profundidad con TEOS-10/GSW.

Para cada agrupación se ofrecen el promedio y la mediana, junto con la desviación estándar y el número de observaciones y perfiles. La mediana es una aproximación ponderada de las medianas calculadas por perfil, no la mediana exacta de todas las mediciones individuales. La vista mensual agrega los registros diarios disponibles.

Los resultados describen las observaciones disponibles en cada agrupación. La cobertura depende de la distribución temporal y espacial de los flotadores; no se interpolan datos para producir un campo oceánico continuo. Las celdas o periodos sin perfiles pueden aparecer sin datos.

## Exploración

- Seleccionar temperatura o salinidad y promedio o mediana.
- Alternar entre resolución diaria y mensual.
- Filtrar por región, celdas del mapa e intervalo de profundidad.
- Consultar la matriz temporal, donde los años se disponen horizontalmente y los meses verticalmente.

## Ejecución local

La aplicación es estática y no requiere compilación ni dependencias JavaScript. Debe servirse mediante HTTP para que el navegador pueda cargar los archivos JSON.

En Windows, ejecuta `start.bat` (requiere Python). También puedes iniciar un servidor desde la carpeta del proyecto:

```bash
python -m http.server 8000
```

Después, abre `http://localhost:8000`.
