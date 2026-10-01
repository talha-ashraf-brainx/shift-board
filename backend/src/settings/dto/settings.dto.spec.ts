import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSettingsDto } from './settings.dto';

async function errors(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateSettingsDto, body);
  const result = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return result.map((e) => e.property);
}

describe('UpdateSettingsDto.notifyWebhookUrl', () => {
  it.each([
    'https://hooks.slack.com/services/T000/B000/XXXX',
    'https://discord.com/api/webhooks/1/abc',
    'http://localhost:8080/hook',
    null,
    '',
    undefined,
  ])('accepts %p', async (url) => {
    expect(await errors({ notifyWebhookUrl: url })).toEqual([]);
  });

  it.each(['ftp://example.com/hook', 'not a url', 'example.com/hook', 42, `https://example.com/${'a'.repeat(2000)}`])(
    'rejects %p',
    async (url) => {
      expect(await errors({ notifyWebhookUrl: url })).toEqual(['notifyWebhookUrl']);
    },
  );
});
