const {google} = require('googleapis');
const oauth2Client = new google.auth.OAuth2(
  process.argv[1],
  process.argv[2],
  'urn:ietf:wg:oauth:2.0:oob'
);
oauth2Client.getToken(process.argv[3], (err, token) => {
  if(err) console.log('Error:', JSON.stringify(err));
  else console.log('Refresh token:', token.refresh_token);
});