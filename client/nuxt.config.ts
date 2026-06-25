export default defineNuxtConfig({
  modules: ["@nuxtjs/tailwindcss"],
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || "http://127.0.0.1:4000"
    }
  },
  routeRules: {
    "/meeting/**": { ssr: false }
  },
  typescript: {
    strict: true
  }
});
