// src/lib/typingSamples.ts

export type SampleLang = "en" | "da";
export type SampleLength = "short" | "medium" | "long";

type SampleDict = Record<SampleLang, Record<SampleLength, string[]>>;

export const SAMPLE_TEXTS: SampleDict = {
  en: {
    short: [
      "The quick brown fox jumps over the lazy dog.",
      "To be or not to be, that is the question.",
      "All that glitters is not gold.",
      "A journey of a thousand miles begins with a single step.",
      "Practice makes perfect, so keep on typing every day.",
    ],
    medium: [
      "Design is not just what it looks like and feels like. Design is how it works. Innovation distinguishes between a leader and a follower.",
      "The only way to do great work is to love what you do. If you haven't found it yet, keep looking. Don't settle.",
      "Success is not final, failure is not fatal: it is the courage to continue that counts. Believe you can and you're halfway there.",
      "In three words I can sum up everything I've learned about life: it goes on. Life is what happens when you're busy making other plans.",
      "Typing speed tests are a fun way to improve your keyboard skills. Try to focus on accuracy first, and the speed will naturally follow over time.",
    ],
    long: [
      "Here's to the crazy ones, the misfits, the rebels, the troublemakers, the round pegs in the square holes. The ones who see things differently. They're not fond of rules. You can quote them, disagree with them, glorify or vilify them, but the only thing you can't do is ignore them because they change things. They push the human race forward, and while some may see them as the crazy ones, we see genius.",
      "We hold these truths to be self-evident, that all men are created equal, that they are endowed by their Creator with certain unalienable Rights, that among these are Life, Liberty and the pursuit of Happiness. That to secure these rights, Governments are instituted among Men, deriving their just powers from the consent of the governed.",
      "Software engineering is a creative and demanding profession. It requires logical thinking, problem-solving skills, and a deep understanding of computer systems. Good code is like poetry; it is elegant, concise, and easy to read. As you write code, always consider the future maintainer, who might be you six months from now.",
    ],
  },
  da: {
    short: [
      "Den hurtige brune ræv hopper over den dovne hund.",
      "At være eller ikke at være, det er spørgsmålet.",
      "Alt er ikke guld, som skinner.",
      "En rejse på tusind mil begynder med et enkelt skridt.",
      "Øvelse gør mester, så bliv ved med at skrive hver dag.",
    ],
    medium: [
      "Design er ikke kun, hvordan det ser ud og føles. Design er, hvordan det virker. Innovation skelner mellem en leder og en følger.",
      "Den eneste måde at gøre et godt stykke arbejde på, er at elske det, du laver. Hvis du ikke har fundet det endnu, så bliv ved med at lede.",
      "Succes er ikke endelig, fiasko er ikke fatal: det er modet til at fortsætte, der tæller. Tro på, at du kan, og du er halvvejs der.",
      "Med tre ord kan jeg opsummere alt, hvad jeg har lært om livet: det går videre. Livet er, hvad der sker, når du har travlt med at lægge andre planer.",
      "Skrivehastighedstests er en sjov måde at forbedre dine tastaturfærdigheder på. Prøv at fokusere på nøjagtighed først, så følger hastigheden efter.",
    ],
    long: [
      "Her er til de skøre, de utilpassede, oprørerne, ballademagerne, de runde pinde i de firkantede huller. Dem, der ser tingene anderledes. De er ikke glade for regler. Du kan citere dem, være uenige med dem, glorificere eller bagvaske dem, men det eneste, du ikke kan gøre, er at ignorere dem, fordi de ændrer tingene.",
      "Vi anser disse sandheder for at være selvindlysende, at alle mennesker er skabt lige, at de af deres Skaber er udstyret med visse ufortabelige rettigheder, at blandt disse er liv, frihed og stræben efter lykke. At for at sikre disse rettigheder er regeringer oprettet blandt mennesker.",
      "Softwareudvikling er et kreativt og krævende erhverv. Det kræver logisk tænkning, problemløsningsevner og en dyb forståelse af computersystemer. God kode er som poesi; det er elegant, kortfattet og let at læse. Når du skriver kode, skal du altid overveje den fremtidige vedligeholder.",
    ],
  },
};

export function pickSample(lang: SampleLang, length: SampleLength): string {
  const pool = SAMPLE_TEXTS[lang][length];
  return pool[Math.floor(Math.random() * pool.length)];
}
