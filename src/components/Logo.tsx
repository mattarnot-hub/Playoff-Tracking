/** Circular Cito Gaston's CG patch, shown top left on every screen. */
export default function Logo() {
  return <img className="logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="Cito Gaston's" width={36} height={36} />;
}
