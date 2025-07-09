import i18next from "i18next";
import ru from "./locales/ru.json";
import en from "./locales/en.json";

export default i18next;

export async function initializeI18n(): Promise<void> {
  await i18next.init({
    lng: process.env.BOT_LANGUAGE || "ru",
    fallbackLng: "en",
    debug: process.env.DEV_MODE === "true",
    resources: {
      en: {
        translation: en,
      },
      ru: {
        translation: ru,
      },
    },
    interpolation: {
      escapeValue: false,
    },
  });
}
