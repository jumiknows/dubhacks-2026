import type { ComponentType } from "react";
import type { ShoppingPlan, PlanItem, Listing } from "../api";
declare const ShopBoard: ComponentType<{
 plans: ShoppingPlan[]; marks: Record<string,string>; focusId: string|null;
 onMark: (itemId:string,tone:string)=>void; onToggle:(item:PlanItem)=>void;
 onInspect:(itemId:string|null)=>void; onAddListing:(item:PlanItem,product:Listing)=>void;
 onCompare:(item:PlanItem,leftId:string,rightId:string)=>void;
 onInteraction?:(event:Record<string,unknown>)=>void;
}>;
export default ShopBoard;
export const LISTING_DRAG_TYPE: string;
