(() => {
  const sections = document.querySelectorAll("map-locations");
  const sectionWithApiKey = [...sections].find((section) =>
    section.getAttribute("google-maps-api-key"),
  );
  const apiKey = sectionWithApiKey?.getAttribute("google-maps-api-key");

  // No section found for some reason or maps API is already loaded/loading.
  if ((!sectionWithApiKey && !Shopify.designMode) || window.googleMapsApi) {
    return;
  }

  if (apiKey) {
    initializeGoogleMapsScript(apiKey);
    return;
  }
})();

function initializeGoogleMapsScript(apiKey) {
  if (!apiKey || window.googleMapsApi) {
    return;
  }

  window.googleMapsApi = true;

  window.initMap = function () {
    registerMapLocationsCustomElement();
  };

  (function (d, script) {
    script = d.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&callback=initMap`;
    d.getElementsByTagName("head")[0].appendChild(script);
  })(document);
}

window.initializeGoogleMapsScript = initializeGoogleMapsScript;

function registerMapLocationsCustomElement() {
  if (!customElements.get("map-locations")) {
    customElements.define(
      "map-locations",
      class MapLocations extends HTMLElement {
        constructor() {
          super();
        }

        connectedCallback() {
          this.init();
        }

        init = async () => {
          this.zoom = parseInt(this.getAttribute("zoom"), 10) || 14;
          this.addressElements = this.querySelectorAll("[data-address]");
          this.resetButtonElement = this.querySelector(".map-card-button-reset");
          this.markerImageUrl = this.getAttribute("marker-image-url");
          this.locations = [...this.addressElements].map((element) => {
            const lat = element.dataset.lat;
            const lng = element.dataset.lng;

            return {
              address: element.dataset.address,
              lat: lat ? parseFloat(lat) : null,
              lng: lng ? parseFloat(lng) : null,
              hasCoordinates: lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng)),
            };
          });
          this.markers = [];
          this.infoWindows = [];
          this.geocoder = new google.maps.Geocoder();
          const colors = this.getAttribute("colors");
          let parsedColors;
          if (colors) {
            try {
              parsedColors = JSON.parse(colors.trim());
            } catch (e) {
              console.warn("Map: invalid map colors, using default styles.", e);
            }
          }
          this.map = new google.maps.Map(
            document.getElementById(`Map-${this.getAttribute("section-id")}`),
            {
              zoom: this.zoom,
              styles: colors ? getMapStyles(parsedColors) : undefined,
            },
          );
          await this.populateMap();

          this.handleLocationClick = this.handleLocationClick.bind(this);
          this.querySelectorAll(".js-location-trigger").forEach((location) => {
            location.addEventListener("click", this.handleLocationClick);
          });

          this.handleReset = this.handleReset.bind(this);
          if (this.resetButtonElement) {
            this.resetButtonElement.addEventListener("click", this.handleReset);
          }
        };

        populateMap = async () => {
          // Markers / Geocoding — keep 1:1 mapping with locations (null = failed geocoding)
          const responses = new Array(this.locations.length).fill(null);
          let geocodingDelayIndex = 0;

          for (const [index, location] of this.locations.entries()) {
            try {
              if (location.hasCoordinates) {
                responses[index] = {
                  results: [
                    {
                      geometry: {
                        location: new google.maps.LatLng(location.lat, location.lng),
                      },
                    },
                  ],
                };
              } else {
                // Fall back to geocoding for addresses without coordinates
                const response = await MapLocations.codeAddress({
                  address: location.address,
                  geocoder: this.geocoder,
                });
                responses[index] = response;

                // Only add delay for geocoded addresses to avoid rate limiting
                await sleep(Math.min(50 * geocodingDelayIndex, 1000));
                geocodingDelayIndex++;
              }
            } catch (error) {
              console.error(error);
            }
          }

          this.markers = new Array(this.locations.length).fill(null);
          this.infoWindows = new Array(this.locations.length).fill(null);

          // Load marker image to get dimensions (preserve aspect ratio)
          let iconConfig = null;
          if (this.markerImageUrl) {
            iconConfig = await new Promise((resolve) => {
              const img = new Image();
              img.onload = () => {
                const maxSize = 40;
                const w = img.naturalWidth;
                const h = img.naturalHeight;
                const scale = maxSize / Math.max(w, h);
                resolve({
                  url: this.markerImageUrl,
                  scaledSize: new google.maps.Size(Math.round(w * scale), Math.round(h * scale)),
                });
              };
              img.onerror = () =>
                resolve({
                  url: this.markerImageUrl,
                  scaledSize: new google.maps.Size(40, 40),
                });
              img.src = this.markerImageUrl;
            });
          }

          let firstValidIndex = -1;
          const position = (r) => r.results[0].geometry.location;
          responses.forEach((response, index) => {
            if (!response?.results?.[0]) return;

            if (firstValidIndex === -1) {
              firstValidIndex = index;
              this.map.setCenter(position(response));
            }

            const marker = new google.maps.Marker({
              map: this.map,
              position: position(response),
              icon: iconConfig || undefined,
            });

            this.markers[index] = marker;
          });

          // Info windows
          this.markers.forEach((marker, index) => {
            if (!marker) return;

            const infoWindow = new google.maps.InfoWindow({
              content: this.getInfoWindow(index),
            });
            this.infoWindows[index] = infoWindow;
          });

          this.markers.forEach((marker, index) => {
            if (!marker) return;

            const infoWindow = this.infoWindows[index];
            const locationIndex = index;

            marker.addListener("click", () => {
              if (this.activeInfoWindow) {
                this.activeInfoWindow.close();
              }

              infoWindow.open({
                anchor: marker,
                map: this.map,
                shouldFocus: false,
              });

              this.activeInfoWindow = infoWindow;

              // Update active state in sidebar when marker is clicked
              this.setActiveLocation(locationIndex);
            });
          });

          const validMarkers = this.markers.filter(Boolean);
          if (validMarkers.length > 1) {
            this.bounds = new google.maps.LatLngBounds();
            validMarkers.forEach((marker) => {
              this.bounds.extend(this.getMarkerPosition(marker));
            });
            this.map.setCenter(this.bounds.getCenter());
            this.map.fitBounds(this.bounds);
          }
        };

        getMarkerPosition(marker) {
          return marker.getPosition ? marker.getPosition() : marker.position;
        }

        handleLocationClick(event) {
          event.preventDefault();
          const element = event.currentTarget.closest(".section-map-locations-location");
          const index = [...element.parentElement.children].indexOf(element);
          const marker = this.markers[index];
          if (!marker) return;
          this.map.setCenter(this.getMarkerPosition(marker));
          this.map.setZoom(this.zoom);
          this.resetButtonElement?.classList.remove("visually-hidden");

          // Update active state
          this.setActiveLocation(index);
        }

        setActiveLocation(index) {
          // Remove active state from all locations
          this.addressElements.forEach((el) => {
            el.closest(".section-map-locations-location").classList.remove("is-active");
          });

          // Add active state to clicked location
          const activeElement = this.addressElements[index].closest(
            ".section-map-locations-location",
          );
          if (activeElement) {
            activeElement.classList.add("is-active");

            // Scroll the active location into view (useful for long lists)
            activeElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }

        handleReset() {
          if (this.bounds) {
            this.map.setCenter(this.bounds.getCenter());
            this.map.fitBounds(this.bounds);
            this.resetButtonElement?.classList.add("visually-hidden");

            // Remove active state from all locations
            this.addressElements.forEach((el) => {
              el.closest(".section-map-locations-location").classList.remove("is-active");
            });
          }
        }

        static codeAddress = async ({ address, geocoder }) => {
          if (!address || !geocoder) {
            return null;
          }

          return geocoder.geocode({ address });
        };

        getInfoWindow(markerIndex) {
          const addressElement = this.addressElements[markerIndex].closest(
            ".section-map-locations-location",
          );

          if (addressElement.dataset.info) {
            return `<div class="map-info-window">${addressElement.dataset.info}</div>`;
          }

          const title = addressElement.querySelector(".location-title")?.textContent || "";
          const content = addressElement.querySelector(".location-address")?.innerHTML;

          return `<div class="map-info-window"><h4>${title}</h4>${content}</div>`;
        }
      },
    );
  }
}

function getMapStyles(colors) {
  if (!colors) {
    return [];
  }

  return [
    {
      elementType: "geometry",
      stylers: [
        {
          color: colors.background,
        },
      ],
    },
    {
      elementType: "labels.icon",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      elementType: "labels.text.fill",
      stylers: [
        {
          color: colors.foreground,
        },
      ],
    },
    {
      elementType: "labels.text.stroke",
      stylers: [
        {
          color: colors.background,
        },
      ],
    },
    {
      featureType: "administrative",
      elementType: "geometry",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      featureType: "administrative.country",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      featureType: "administrative.land_parcel",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      featureType: "administrative.neighborhood",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      featureType: "administrative.locality",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      featureType: "poi",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      featureType: "road",
      elementType: "geometry.fill",
      stylers: [
        {
          color: colors.fb_3,
        },
      ],
    },
    {
      featureType: "road",
      elementType: "labels.icon",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      featureType: "road.arterial",
      elementType: "geometry",
      stylers: [
        {
          color: colors.fb_2,
        },
      ],
    },
    {
      featureType: "road.highway",
      elementType: "geometry",
      stylers: [
        {
          color: colors.fb_1,
        },
      ],
    },
    {
      featureType: "road.highway.controlled_access",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      featureType: "road.local",
      elementType: "labels.text.fill",
      stylers: [
        {
          color: colors.fb_1,
        },
      ],
    },
    {
      featureType: "road.local",
      elementType: "labels.text.stroke",
      stylers: [
        {
          color: colors.background,
        },
      ],
    },
    {
      featureType: "transit",
      stylers: [
        {
          visibility: "off",
        },
      ],
    },
    {
      featureType: "water",
      elementType: "geometry",
      stylers: [
        {
          color: colors.bm,
        },
      ],
    },
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
