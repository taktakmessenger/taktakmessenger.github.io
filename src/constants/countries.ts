export interface Country {
  name: string;
  code: string;
  flag: string;
}

export const countries: Country[] = [
  { name: "Venezuela", code: "+58", flag: "🇻🇪" },
  { name: "Colombia", code: "+57", flag: "🇨🇴" },
  { name: "España", code: "+34", flag: "🇪🇸" },
  { name: "Estados Unidos", code: "+1", flag: "🇺🇸" },
  { name: "México", code: "+52", flag: "🇲🇽" },
  { name: "Argentina", code: "+54", flag: "🇦🇷" },
  { name: "Chile", code: "+56", flag: "🇨🇱" },
  { name: "Perú", code: "+51", flag: "🇵🇪" },
  { name: "Ecuador", code: "+593", flag: "🇪🇨" },
  { name: "República Dominicana", code: "+1-809", flag: "🇩🇴" },
  { name: "Panamá", code: "+507", flag: "🇵🇦" },
  { name: "Costa Rica", code: "+506", flag: "🇨🇷" },
  { name: "Brasil", code: "+55", flag: "🇧🇷" },
  { name: "Portugal", code: "+351", flag: "🇵🇹" },
  { name: "Italia", code: "+39", flag: "🇮🇹" },
  { name: "Francia", code: "+33", flag: "🇫🇷" },
  { name: "Alemania", code: "+49", flag: "🇩🇪" },
  { name: "Reino Unido", code: "+44", flag: "🇬🇧" },
  { name: "Canadá", code: "+1", flag: "🇨🇦" },
  { name: "China", code: "+86", flag: "🇨🇳" },
  { name: "Japón", code: "+81", flag: "🇯🇵" },
  { name: "Corea del Sur", code: "+82", flag: "🇰🇷" },
].sort((a, b) => a.name.localeCompare(b.name));
