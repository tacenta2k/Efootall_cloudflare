import { z } from 'zod';
import { tieRules } from './types';
import { logoPattern } from './logos';
const name = z.string().trim().min(1, 'A name is required.').max(48, 'Use 48 characters or fewer.');
const avatar = z.union([
  z
    .string()
    .trim()
    .min(1)
    .max(16)
    .refine((v) => !v.startsWith('logo:')),
  z.string().regex(logoPattern),
]);
export const playerSchema = z.object({ id: z.string().uuid(), name, avatar }).strict();
export const settingsSchema = z
  .object({
    name: name.max(70),
    repetitions: z.number().int().min(1).max(4),
    win: z.number().int().min(0).max(20),
    draw: z.number().int().min(0).max(20),
    loss: z.number().int().min(0).max(20),
    leagueDrawsAllowed: z.boolean().default(true),
    // No default points split: it must be explicitly supplied before finalizing penalties.
    leaguePenaltyPoints: z
      .object({
        winner: z.number().int().min(0).max(20),
        loser: z.number().int().min(0).max(20),
      })
      .strict()
      .nullable()
      .default(null),
    knockout: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(8)]),
    legs: z.union([z.literal(1), z.literal(2)]),
    tieRules: z
      .array(z.enum(tieRules))
      .length(5)
      .refine((r) => new Set(r).size === 5, 'Use every tie-break rule exactly once.'),
    resolution: z.enum(['penalties', 'manual', 'either']),
  })
  .strict()
  .refine(
    (s) => s.win > s.draw && s.draw >= s.loss,
    'Win points must exceed draw points; draw points must be at least loss points.',
  );
export const setupSchema = z
  .object({ settings: settingsSchema, players: z.array(playerSchema).min(2).max(32) })
  .strict()
  .superRefine((s, ctx) => {
    if (
      new Set(s.players.map((p) => p.name.normalize('NFKC').toLocaleLowerCase('en'))).size !==
      s.players.length
    )
      ctx.addIssue({ code: 'custom', message: 'Player names must be unique.' });
    if (new Set(s.players.map((p) => p.id)).size !== s.players.length)
      ctx.addIssue({ code: 'custom', message: 'Player identifiers must be unique.' });
    if (s.settings.knockout > s.players.length)
      ctx.addIssue({
        code: 'custom',
        message: 'There are not enough players for this knockout size.',
      });
  });
const score = z.number().int().min(0).max(999);
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }).strict(),
  z
    .object({
      type: z.literal('settings'),
      settings: settingsSchema,
      players: z.array(playerSchema),
    })
    .strict(),
  z.object({ type: z.literal('avatar'), playerId: z.string().uuid(), avatar }).strict(),
  z
    .object({
      type: z.literal('score'),
      matchId: z.string().uuid(),
      home: score,
      away: score,
      confirmEdit: z.boolean(),
      leaguePenalties: z
        .object({ home: score, away: score })
        .strict()
        .refine((p) => p.home !== p.away, 'Penalty scores must determine a winner.')
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('resetMatch'),
      matchId: z.string().uuid(),
      confirmation: z.literal('RESET'),
    })
    .strict(),
  z.object({ type: z.literal('advance') }).strict(),
  z
    .object({ type: z.literal('resolveOrder'), order: z.array(z.string().uuid()).min(2).max(32) })
    .strict(),
  z
    .object({
      type: z.literal('resolveTie'),
      tieId: z.string().uuid(),
      winner: z.string().uuid(),
      method: z.enum(['penalties', 'manual']),
      penaltiesA: score.optional(),
      penaltiesB: score.optional(),
      extraTime: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('reset'),
      scope: z.enum(['league', 'tournament', 'knockout']),
      confirmation: z.literal('RESET'),
    })
    .strict(),
]);
