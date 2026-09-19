import { eq, asc, inArray, and } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Category, Game, Publisher } from '../types/game';

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

export interface GameFilterOptions {
    categoryIds?: number[];
    publisherIds?: number[];
}

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

function applyGameFilters(query: ReturnType<typeof baseGamesQuery>, filters: GameFilterOptions = {}) {
    const categoryIds = filters.categoryIds?.filter((id) => id !== undefined && id !== null) ?? [];
    const publisherIds = filters.publisherIds?.filter((id) => id !== undefined && id !== null) ?? [];

    const clauses = [];

    if (categoryIds.length > 0) {
        clauses.push(inArray(games.categoryId, categoryIds));
    }

    if (publisherIds.length > 0) {
        clauses.push(inArray(games.publisherId, publisherIds));
    }

    if (clauses.length === 0) {
        return query;
    }

    return query.where(and(...clauses));
}

/**
 * Fetches all games in alphabetical order, optionally constrained to the selected categories and publishers.
 *
 * @param db - The injected Drizzle database client used to read the game catalog.
 * @param filters - Optional category and publisher IDs to include in the result set.
 * @returns A list of mapped game records with related category and publisher data attached.
 */
export async function getAllGames(db: Database, filters: GameFilterOptions = {}): Promise<Game[]> {
    const rows = await applyGameFilters(baseGamesQuery(db), filters).orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Fetches all categories alphabetized by name for filter controls and metadata.
 *
 * @param db - The injected Drizzle database client used to read category rows.
 * @returns A list of categories with their stable numeric IDs and display names.
 */
export async function getAllCategories(db: Database): Promise<Category[]> {
    const rows = await db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.name));
    return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Fetches all publishers alphabetized by name for filter controls and metadata.
 *
 * @param db - The injected Drizzle database client used to read publisher rows.
 * @returns A list of publishers with their stable numeric IDs and display names.
 */
export async function getAllPublishers(db: Database): Promise<Publisher[]> {
    const rows = await db
        .select({ id: publishers.id, name: publishers.name })
        .from(publishers)
        .orderBy(asc(publishers.name));
    return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Fetches every game ID in alphabetical title order so callers can enumerate routes or derive stable ordering.
 *
 * @param db - The injected Drizzle database client used to read the primary key values.
 * @returns A list of game IDs ordered by title.
 */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/**
 * Fetches a single game record by ID, including its category and publisher details when present.
 *
 * @param db - The injected Drizzle database client used to read the game row.
 * @param id - The unique game ID to look up.
 * @returns The matching game, or `null` when no row exists for the provided ID.
 */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
