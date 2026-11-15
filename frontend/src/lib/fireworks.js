// Celebración de la casa: lanza varios estallidos repartidos en círculo
// alrededor de un punto. Vive aparte del componente para poder probarla sin
// navegador ni React.
export const HOUSE_HUES = [45, 285, 325, 170];

export function celebrate(fire, x, y, hues = HOUSE_HUES) {
  hues.forEach((hue, i) => {
    const angle = (i / hues.length) * Math.PI * 2;
    setTimeout(
      () => fire(x + Math.cos(angle) * 90, y + Math.sin(angle) * 60, hue),
      i * 130,
    );
  });
}
