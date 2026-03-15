import logging
from typing import Optional

from sqlalchemy import select

from backend.db import async_session_factory, RecipeRow
from backend.models.recipe import Recipe

logger = logging.getLogger(__name__)


async def save_recipe(recipe: Recipe) -> Recipe:
    data = recipe.model_dump(mode="json")
    async with async_session_factory() as db:
        async with db.begin():
            row = await db.get(RecipeRow, recipe.id)
            if row:
                row.title = recipe.title
                row.data = data
            else:
                db.add(RecipeRow(id=recipe.id, title=recipe.title, data=data))
    logger.info("Saved recipe %s (%s)", recipe.id, recipe.title)
    return recipe


async def get_recipe(recipe_id: str) -> Optional[Recipe]:
    async with async_session_factory() as db:
        row = await db.get(RecipeRow, recipe_id)
        if not row:
            return None
        return Recipe.model_validate(row.data)


async def list_recipes() -> list[dict]:
    async with async_session_factory() as db:
        result = await db.execute(select(RecipeRow).order_by(RecipeRow.created_at.desc()))
        rows = result.scalars().all()
    summaries = []
    for row in rows:
        try:
            summaries.append(Recipe.model_validate(row.data).summary())
        except Exception as exc:
            logger.warning("Skipping malformed recipe %s: %s", row.id, exc)
    return summaries


async def delete_recipe(recipe_id: str) -> bool:
    async with async_session_factory() as db:
        async with db.begin():
            row = await db.get(RecipeRow, recipe_id)
            if not row:
                return False
            await db.delete(row)
    logger.info("Deleted recipe %s", recipe_id)
    return True
