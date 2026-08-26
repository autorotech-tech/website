import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3105);
const app = createApp();

app.listen(port, () => {
  console.log(`lead-validation listening on http://127.0.0.1:${port}`);
});
