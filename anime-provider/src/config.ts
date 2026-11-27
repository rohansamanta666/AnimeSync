const config = {
  baseurl: process.env.ANIME_PROVIDER_BASEURL || 'https://zanix.tr',
  origin: process.env.ANIME_PROVIDER_ORIGIN || '*',
  port: Number(process.env.PORT) || 5000,

  headers: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
  },

  logLevel: 'INFO',
  enableLogging: false,
  isProduction: true,
  isDevelopment: false,
  isVercel: false,
};

export default config;
