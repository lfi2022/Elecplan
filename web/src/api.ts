export let csrf = '';
export function setCsrf(value:string) { csrf=value; }
export async function api<T=any>(url:string,method='GET',body?:unknown):Promise<T> {
  const response=await fetch(`/api${url}`,{method,credentials:'same-origin',headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error+(result.details?` ${result.details.join(' ; ')}`:''));
  return result;
}
export const formatDate=(s:string)=>new Date(s).toLocaleString('fr-BE',{dateStyle:'short',timeStyle:'short'});
export const bytes=(n:number)=>n>1048576?`${(n/1048576).toFixed(1)} Mo`:`${Math.ceil(n/1024)} Ko`;
export type Location={id:string;kind:string;name:string;reference:string;description:string;parentId:string|null;siteId:string};
export const labels:Record<string,string>={SITE:'Site',BUILDING:'Bâtiment',FLOOR:'Étage',ZONE:'Zone',ROOM:'Local',PANEL:'Tableau électrique',EQUIPMENT:'Équipement',ADMIN:'Administrateur',EDITOR:'Éditeur',READER:'Lecteur'};
