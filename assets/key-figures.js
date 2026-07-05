if (!customElements.get("key-figures")) {
  customElements.define(
    "key-figures",
    class KeyFigures extends HTMLElement {
      constructor() {
        super();
        this.animated = false;
      }

      connectedCallback() {
        if (this.offsetParent === null) {
          return;
        }

        const animateOnScroll = this.dataset.animateOnScroll === "true";

        if (animateOnScroll) {
          this.setupIntersectionObserver();
        } else {
          this.animateAllFigures();
        }
      }

      setupIntersectionObserver() {
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting && !this.animated) {
                this.animated = true;
                this.animateAllFigures();
                observer.disconnect();
              }
            });
          },
          {
            threshold: 0.2,
            rootMargin: "0px 0px -50px 0px",
          },
        );

        observer.observe(this);
      }

      animateAllFigures() {
        const figures = this.querySelectorAll(".key-figures-value");
        const duration = parseFloat(this.dataset.duration) || 2000;

        figures.forEach((figure) => {
          this.animateValue(figure, duration);
        });
      }

      animateValue(element, duration) {
        const targetValue = parseFloat(element.dataset.value);

        if (isNaN(targetValue)) {
          return;
        }

        const decimalPlaces = this.getDecimalPlaces(element.dataset.value);
        const startTime = performance.now();

        const animate = (currentTime) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);

          // Ease out cubic for smooth deceleration
          const easedProgress = 1 - Math.pow(1 - progress, 3);

          const currentValue = targetValue * easedProgress;
          element.textContent = this.formatNumber(currentValue, decimalPlaces);

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            element.textContent = this.formatNumber(targetValue, decimalPlaces);
          }
        };

        requestAnimationFrame(animate);
      }

      getDecimalPlaces(valueString) {
        const parts = valueString.split(".");
        return parts.length > 1 ? parts[1].length : 0;
      }

      formatNumber(value, decimalPlaces) {
        return value.toFixed(decimalPlaces);
      }
    },
  );
}
