from fastapi import APIRouter, HTTPException
from backend.services.recipe_store import get_recipe, list_recipes, delete_recipe
from backend.models.recipe import Recipe

router = APIRouter(prefix="/recipes", tags=["recipes"])


@router.get("", response_model=list[dict])
async def get_all_recipes():
    return await list_recipes()


@router.get("/{recipe_id}", response_model=Recipe)
async def get_recipe_by_id(recipe_id: str):
    recipe = await get_recipe(recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@router.delete("/{recipe_id}")
async def delete_recipe_by_id(recipe_id: str):
    deleted = await delete_recipe(recipe_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"deleted": recipe_id}
