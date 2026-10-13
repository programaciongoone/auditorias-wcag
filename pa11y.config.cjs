module.exports = {
  runners: ['axe'],
  standard: 'WCAG2AA',
  timeout: 60000,
  wait: 1500,
  chromeLaunchConfig: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
};
