// Obtén el parámetro de la URL
const urlParams = new URLSearchParams(window.location.search);
const truckNumber = urlParams.get('truck');

$('#startTracking').click(function () {
    var $button = $(this);

    if ($button.hasClass('btn-success')) {
        $button.removeClass('btn-success').addClass('btn-danger');
        $button.text('Stop Tracking');
        requestLocationPermissionAndSetupMap();
    } else {
        $button.removeClass('btn-danger').addClass('btn-success');
        $button.text('Start Tracking');
        stopTracking();
    }
});

let track;
let polygons = []; // Polígonos cargados desde el WebMap
let pointLayers = []; // Capas de puntos
let polygonLayers = []; // Capas de polígonos

function requestLocationPermissionAndSetupMap() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function (position) {
                setupMap();
            },
            function (error) {
                handleGeolocationError(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );
    } else {
        alert("Geolocation is not supported by this browser.");
    }
}

function setupMap() {
    require([
        "esri/views/MapView",
        "esri/WebMap",
        "esri/Graphic",
        "esri/geometry/Point",
        "esri/geometry/projection",
        "esri/geometry/geometryEngine"
    ], function (MapView, WebMap, Graphic, Point, projection, geometryEngine) {
        const webmap = new WebMap({
            portalItem: {
                id: "3c9ffafc712c4a35a4d257db153007f0" // Tu item ID
            }
        });

        // Cargar el WebMap y clasificar las capas por tipo de geometría
        webmap.when(() => {
            console.log("El webmap se ha cargado correctamente.");

            const polygonLoadPromises = [];

            webmap.layers.forEach((layer) => {
                if (layer.type === "feature") {
                    const featureLayer = layer;

                    const loadPromise = featureLayer.load().then(() => {
                        if (featureLayer.geometryType === "polygon") {
                            polygonLayers.push(featureLayer); // Agrega la capa de polígonos
                            return featureLayer.queryFeatures({
                                where: "Day IS NOT NULL AND Day <> ''", // Filtro para el campo Day
                                returnGeometry: true,
                                outFields: ["*"] // Incluye los campos necesarios
                            }).then((results) => {
                                results.features.forEach((feature) => {
                                    const geometry = feature.geometry;
                                    const attributes = feature.attributes;

                                    console.log("Polígono con Day:", attributes.Day); // Verifica el valor de Day

                                    // Evitar duplicados
                                    const isDuplicate = polygons.some((polygon) =>
                                        JSON.stringify(polygon) === JSON.stringify(geometry)
                                    );

                                    if (!isDuplicate) {
                                        polygons.push(geometry);
                                    }
                                });
                            });
                        } else if (featureLayer.geometryType === "point") {
                            pointLayers.push(featureLayer); // Agrega la capa de puntos
                        }
                    }).catch((error) => {
                        console.error(`Error al procesar la capa ${featureLayer.title}:`, error);
                    });

                    polygonLoadPromises.push(loadPromise);
                }
            });

            // Maneja el resultado de todas las promesas, incluso si alguna falla
            Promise.allSettled(polygonLoadPromises).then((results) => {
                const fulfilled = results.filter(result => result.status === "fulfilled").length;
                const rejected = results.filter(result => result.status === "rejected").length;

                console.log(`Promesas cumplidas: ${fulfilled}, Promesas rechazadas: ${rejected}`);
                console.log(`Se han cargado ${polygons.length} polígonos con Day:`, polygons);

                if (polygons.length > 0) {
                    // Llama a la función para verificar la posición del dispositivo
                    checkDeviceLocation();
                } else {
                    console.warn("No se cargaron polígonos válidos.");
                }
            });
        });

        const view = new MapView({
            container: "viewDiv",
            map: webmap,
            zoom: 5
        });

        function checkDeviceLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((position) => {
                    const { latitude, longitude } = position.coords;
        
                    let deviceLocation = new Point({
                        longitude: longitude,
                        latitude: latitude,
                        spatialReference: { wkid: 4326 } // WGS 84
                    });
        
                    projection.load().then(() => {
                        const targetSpatialReference = polygons[0]?.spatialReference || { wkid: 3857 };
        
                        if (!deviceLocation.spatialReference.equals(targetSpatialReference)) {
                            deviceLocation = projection.project(deviceLocation, targetSpatialReference);
                        }
        
                        // Crear un marcador para el dispositivo
                        const markerSymbol = {
                            type: "picture-marker",
                            url: "https://static.arcgis.com/images/Symbols/Shapes/BluePin1LargeB.png",
                            width: "36px",
                            height: "36px"
                        };
        
                        const deviceGraphic = new Graphic({
                            geometry: deviceLocation,
                            symbol: markerSymbol,
                            popupTemplate: {
                                title: "Tu ubicación",
                                content: `Latitud: ${latitude.toFixed(6)} <br> Longitud: ${longitude.toFixed(6)}`
                            }
                        });
        
                        view.graphics.add(deviceGraphic);
        
                        view.goTo({
                            center: deviceLocation,
                            zoom: 15
                        });
        
                        // Verifica si el punto está dentro de algún polígono
                        let insidePolygonIndex = -1;
        
                        polygons.forEach((polygon, index) => {
                            if (geometryEngine.contains(polygon, deviceLocation)) {
                                insidePolygonIndex = index;
                            }
                        });
        
                        if (insidePolygonIndex !== -1) {
                            console.log("Tu ubicación está dentro de uno de los polígonos.");
        
                            // Apagar las capas de polígonos
                            polygonLayers.forEach((layer) => {
                                if (layer.title !== "City Boundary view") { // Excluir el layer "City Boundary view"
                                    layer.visible = false; // Oculta la capa
                                }
                            });
        
                            // Activar las capas de puntos
                            pointLayers.forEach((layer) => {
                                layer.visible = true; // Muestra la capa
                            });
        
                            // Mostrar solo el polígono que contiene la ubicación
                            view.graphics.removeAll(); // Elimina todos los gráficos del mapa
        
                            const selectedPolygon = polygons[insidePolygonIndex];
        
                            const polygonGraphic = new Graphic({
                                geometry: selectedPolygon,
                                symbol: {
                                    type: "simple-fill",
                                    color: [0, 216, 0, 0.2], // Verde semitransparente
                                    outline: {
                                        color: [220, 82, 0],
                                        width: 3
                                    }
                                }
                            });
        
                            view.graphics.add(polygonGraphic); // Agrega solo el polígono seleccionado
                            view.graphics.add(deviceGraphic); // Vuelve a agregar la ubicación del dispositivo
                        } else {
                            console.log("Tu ubicación NO coincide con ninguno de los polígonos.");
                        }
                    });
                }, (error) => {
                    console.error("Error obteniendo la ubicación:", error);
                });
            } else {
                console.error("La geolocalización no está soportada en este navegador.");
            }
        }
        
        
    });
}

function stopTracking() {
    if (track) {
        track.stop();
        track = null; // Libera recursos
    }
}

function handleGeolocationError(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            alert("User denied the request for Geolocation.");
            break;
        case error.POSITION_UNAVAILABLE:
            alert("Location information is unavailable.");
            break;
        case error.TIMEOUT:
            alert("The request to get user location timed out.");
            break;
        case error.UNKNOWN_ERROR:
            alert("An unknown error occurred.");
            break;
    }
    $('#startTracking').removeClass('btn-danger').addClass('btn-success').text('Start Tracking');
}

